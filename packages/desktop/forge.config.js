import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';

// NOTE: this config is intentionally .js (ESM), not .ts.
// electron-forge 7.11 loads .ts/.cts/.mts configs through jiti, which transpiles
// the import graph (incl. @electron-forge/plugin-vite + Vite internals that use
// import.meta) and throws "Cannot use 'import.meta' outside a module" on some
// platforms. A plain ESM .js config loads via native import() (no jiti) and works
// identically on Windows + Linux. See CONTRIBUTING.md "Releasing the desktop app".

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    name: 'Stellavault',
    executableName: 'stellavault',
    asar: true,
    icon: './assets/icon',
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
  ],
};

export default config;
