import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';

// NOTE: this config is intentionally .js (ESM), not .ts.
// electron-forge 7.11 loads .ts/.cts/.mts configs through jiti, which transpiles
// the import graph (incl. @electron-forge/plugin-vite + Vite internals that use
// import.meta) and throws "Cannot use 'import.meta' outside a module" on some
// platforms. A plain ESM .js config loads via native import() (no jiti) and works
// identically on Windows + Linux. See CONTRIBUTING.md "Releasing the desktop app".

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Native-dependency packaging for an npm-workspaces monorepo.
//
// THE PROBLEM (verified against this repo):
//   @stellavault/core is a workspace package symlinked into node_modules, and its
//   runtime deps (better-sqlite3, sqlite-vec, @xenova/transformers, …) are HOISTED
//   to the repo-ROOT node_modules — they do NOT exist in packages/desktop/node_modules.
//   @electron/packager's dependency walker does not follow the workspace symlink +
//   parent-hoisted deps, so it silently omits ALL of them. The build stays green but
//   the packaged app.asar contains none of core / better-sqlite3 / sqlite-vec, and
//   the app cannot launch core (failures are swallowed in src/main/index.ts).
//
// THE FIX:
//   A packageAfterCopy hook that copies the *production dependency closure* (the Vite
//   externals + @stellavault/core's built dist + every transitive dependency, incl.
//   platform-specific native subpackages like sqlite-vec-<plat>-<arch>) from wherever
//   each module actually resolves (root node_modules, or the symlink target for core)
//   into the packaged app's node_modules.
//
// HOOK / REBUILD ORDERING (verified in @electron-forge/core@7.11.1 api/package.js
// and @electron/packager platform.js):
//   copy app (packager omits hoisted deps)
//     → afterCopy phase, IN THIS ORDER:
//         1. runHook('packageAfterCopy')  → THIS hook runs first, then plugin-vite's
//         2. listrCompatibleRebuildHook    → @electron/rebuild walks buildPath/node_modules
//   Because rebuild runs AFTER packageAfterCopy in the same phase, and its ModuleWalker
//   recursively walks buildPath/node_modules and rebuilds every dir that has a
//   binding.gyp, the better-sqlite3 we copy here IS picked up and rebuilt against
//   Electron's ABI automatically. We do NOT need to invoke @electron/rebuild ourselves.
//     → asar pack (with the unpack glob below) runs LAST, so the rebuilt .node and the
//       sqlite-vec .dll/.so end up in app.asar.unpacked.
//
// PLATFORM NOTE: native binaries are platform-specific. better-sqlite3 must be compiled
// per-OS (Electron ABI), sqlite-vec / onnxruntime-node ship per-platform binaries. That
// is why CI builds natively on windows-latest AND ubuntu-latest — on each runner only
// that platform's binaries are installed/hoisted, and this hook copies whatever is
// present (missing other-platform optional subpackages are skipped, not fatal).

/**
 * The runtime modules the main process require()s but Vite leaves external
 * (must match vite.main.config.ts `external`), plus the workspace core package.
 * Everything reachable from these via package.json "dependencies" /
 * "optionalDependencies" is collected transitively.
 */
const CLOSURE_ROOTS = [
  '@stellavault/core',
  'better-sqlite3',
  'sqlite-vec',
  '@xenova/transformers',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
  'sharp',
  'unpdf',
  'mammoth',
  'officeparser',
  'xlsx',
  'express',
  'cors',
  'multer',
  'chokidar',
  'gray-matter',
  'hyperswarm',
  'b4a',
  'open',
];

/**
 * Resolve a module's real on-disk directory.
 * - Resolves via require.resolve from the desktop package (which transparently
 *   follows npm's symlink + hoisting), falling back to a direct lookup in the
 *   repo-root node_modules.
 * - Returns the REAL path (symlinks resolved) so @stellavault/core resolves to
 *   packages/core, and we copy real files rather than a dangling symlink.
 */
function resolvePkgDir(name, searchPaths) {
  // Try Node resolution first (handles scoped names, exports maps, hoisting).
  try {
    const pjPath = require.resolve(`${name}/package.json`, { paths: searchPaths });
    return fs.realpathSync(dirname(pjPath));
  } catch {
    // Fallback: walk candidate node_modules dirs directly. Needed for packages
    // whose package.json is blocked by an "exports" map (require.resolve of
    // "<name>/package.json" can throw ERR_PACKAGE_PATH_NOT_EXPORTED).
    for (const base of searchPaths) {
      const dir = join(base, ...name.split('/'));
      if (fs.existsSync(join(dir, 'package.json'))) return fs.realpathSync(dir);
    }
  }
  return null;
}

/**
 * Collect the transitive production closure as a map name -> realDir.
 * Reads each package.json's dependencies + optionalDependencies (NOT devDependencies),
 * so only runtime deps are copied. Missing optional/other-platform subpackages are
 * silently skipped (e.g. sqlite-vec-darwin-arm64 on a Windows runner).
 */
function collectClosure(rootDir) {
  const rootNodeModules = join(rootDir, 'node_modules');
  // Search order: repo-root node_modules first (where hoisted deps live), then the
  // desktop package's own node_modules (its un-hoisted deps).
  const searchPaths = [rootNodeModules, join(__dirname, 'node_modules')];

  const closure = new Map(); // name -> realDir
  const visited = new Set();

  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);

    const dir = resolvePkgDir(name, searchPaths);
    if (!dir) {
      // Unresolved: fine for other-platform optional natives; warn for the rest so a
      // genuinely missing runtime dep is visible in CI logs.
      if (!/(?:^|\/)(?:sqlite-vec|@img\/|@napi-rs\/|onnxruntime-).*(?:darwin|linux|win32|windows|musl|arm|aarch|x64|ia32)/.test(name)) {
        console.warn(`[forge] closure: could not resolve "${name}" — skipping`);
      }
      return;
    }

    closure.set(name, dir);

    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      return;
    }
    const deps = { ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const dep of Object.keys(deps)) visit(dep);
  };

  for (const root of CLOSURE_ROOTS) visit(root);
  return closure;
}

/**
 * Copy one module dir into the packaged app's node_modules/<name>, excluding the
 * junk that would bloat the asar or confuse @electron/rebuild. We KEEP build inputs
 * (binding.gyp, src/, deps/, build/, prebuilds/, *.node, *.dll, *.so) because rebuild
 * needs better-sqlite3's gyp sources and the loadable-extension binaries must ship.
 */
async function copyModule(name, fromDir, appNodeModules) {
  const dest = join(appNodeModules, ...name.split('/'));
  await fs.promises.cp(fromDir, dest, {
    recursive: true,
    dereference: true, // materialize symlinks (esp. @stellavault/core → packages/core)
    force: true,
    filter: (src) => {
      const base = src.split(/[\\/]/).pop();
      // Skip nested node_modules — we flatten the whole closure ourselves, so nested
      // copies would duplicate (and re-introduce symlinks). Transitive deps are already
      // collected as top-level entries by collectClosure().
      if (base === 'node_modules') return false;
      if (base === '.git' || base === '.github' || base === '.vscode') return false;
      return true;
    },
  });
}

/**
 * packageAfterCopy: copy the production dependency closure into the packaged app.
 * Runs BEFORE @electron/rebuild (same afterCopy phase) and BEFORE asar packing, so
 * better-sqlite3 gets rebuilt for Electron's ABI and all natives get unpacked.
 *
 * @param {import('@electron-forge/shared-types').ForgeConfig} _forgeConfig
 * @param {string} buildPath  the copied app dir (== <out>/resources/app)
 * @param {string} _electronVersion
 * @param {string} platform
 * @param {string} arch
 */
const packageAfterCopy = async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
  const repoRoot = resolve(__dirname, '..', '..'); // packages/desktop → repo root
  const appNodeModules = join(buildPath, 'node_modules');
  await fs.promises.mkdir(appNodeModules, { recursive: true });

  const closure = collectClosure(repoRoot);

  let copied = 0;
  for (const [name, fromDir] of closure) {
    await copyModule(name, fromDir, appNodeModules);
    copied++;
  }

  // Hard fail if the load-bearing natives didn't make it in — turns the historically
  // SILENT failure (green build, app can't launch core) into a loud build error.
  const mustExist = [
    'better-sqlite3/package.json',
    '@stellavault/core/dist/index.js',
    '@xenova/transformers/package.json',
  ];
  const missing = mustExist.filter((rel) => !fs.existsSync(join(appNodeModules, ...rel.split('/'))));
  if (missing.length) {
    throw new Error(
      `[forge] packageAfterCopy: closure copy incomplete on ${platform}-${arch}; missing: ${missing.join(', ')}`
    );
  }

  // sqlite-vec needs the platform loadable-extension subpackage for THIS os/arch.
  const vecPkg = `sqlite-vec-${platform === 'win32' ? 'windows' : platform}-${arch}`;
  if (!fs.existsSync(join(appNodeModules, vecPkg))) {
    throw new Error(
      `[forge] packageAfterCopy: ${vecPkg} not found in closure — sqlite-vec will fail to load at runtime on ${platform}-${arch}. ` +
        `Ensure deps are freshly installed on the build runner (it ships only the current platform's binary).`
    );
  }

  console.log(`[forge] packageAfterCopy: copied ${copied} modules into ${appNodeModules} (${platform}-${arch})`);
};

/**
 * packageAfterPrune: strip "type":"module" from the packaged package.json.
 * It exists in packages/desktop/package.json only so Node loads forge.config.js as ESM
 * at BUILD time. The Vite output shipped in the app (.vite/build/index.js + chunks) is
 * CommonJS — leaving type:module makes Electron parse the main entry as ESM and die on
 * startup with "ReferenceError: require is not defined in ES module scope" (error
 * dialog, no window — looks like a silent hang). Runs at afterPrune because the
 * packaged package.json does not exist yet during afterCopy.
 *
 * @param {import('@electron-forge/shared-types').ForgeConfig} _forgeConfig
 * @param {string} buildPath
 */
const packageAfterPrune = async (_forgeConfig, buildPath) => {
  const pkgJsonPath = join(buildPath, 'package.json');
  const pkg = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf-8'));
  delete pkg.type;
  await fs.promises.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2), 'utf-8');
  console.log('[forge] packageAfterPrune: stripped "type":"module" from packaged package.json (Vite main bundle is CJS)');
};

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    name: 'Stellavault',
    executableName: 'stellavault',
    // Unpack every native binary so Electron can dlopen it from disk (cannot dlopen
    // from inside an asar). Covers better-sqlite3's .node, sqlite-vec's .dll/.so/.dylib,
    // and onnxruntime-node's prebuilt .node. auto-unpack-natives (below) also unpacks
    // *.node, but it scans the app node_modules during *generateAssets* — BEFORE our
    // packageAfterCopy adds the closure — so it would miss the copied modules. This
    // explicit glob is the source of truth; the plugin is kept as defense-in-depth.
    asar: {
      unpack: '**/*.{node,dll,dylib,so,so.*}',
    },
    icon: './assets/icon',
  },
  rebuildConfig: {
    // better-sqlite3 is the only binding.gyp module in the closure; force ensures it is
    // rebuilt against Electron's ABI even if a Node-ABI prebuild was copied in.
    force: true,
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({ name: 'stellavault', authors: 'Evanciel', description: 'Stellavault Desktop' }),
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
    new MakerDeb({ options: { name: 'stellavault', productName: 'Stellavault' } }),
    new MakerDMG({ name: 'Stellavault' }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
    // Defense-in-depth: unpack *.node from the app node_modules. The explicit
    // packagerConfig.asar.unpack glob above is the primary mechanism (it also covers
    // .dll/.so which this plugin does not, and runs over the final tree).
    new AutoUnpackNativesPlugin({}),
  ],
  hooks: {
    packageAfterCopy,
    packageAfterPrune,
  },
};

export default config;
