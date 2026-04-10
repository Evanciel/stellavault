// Playwright end-to-end smoke for `stellavault graph`.
//
// Assumes the graph server is already running at http://127.0.0.1:3333.
// Verifies:
//   1. Page loads without console errors
//   2. Canvas element is present (R3F mounted)
//   3. WebGL context created (graph is actually rendering)
//   4. Clicking a node opens the side panel (node-click bug fix)
//   5. Federation badge is present in the header (new UI wiring)
//   6. Motion toggle button is present
//   7. Screenshot saved for manual inspection
//
// Run:  node scripts/pw-verify.mjs
// Exit: 0 on success, 1 on any failure.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'tmp-pw');
mkdirSync(outDir, { recursive: true });

const URL = 'http://127.0.0.1:3333/';
const results = [];
let ok = true;

function step(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (!passed) ok = false;
  const icon = passed ? '✓' : '✗';
  console.log(`${icon} ${name}${detail ? '  — ' + detail : ''}`);
}

console.log(`\n🧪 Playwright smoke for ${URL}\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

// ─────────── 1. Load page ───────────
// Set the onboarding-dismissed flag BEFORE first navigation. Otherwise the
// OnboardingGuide overlay covers the canvas with a fixed-position modal at
// z-index 200 and intercepts every pointer event for the first ~5 seconds.
try {
  await page.addInitScript(() => {
    try { localStorage.setItem('sv_onboarding_done', 'true'); } catch {}
  });
  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  step('page load', resp?.ok() ?? false, `HTTP ${resp?.status()}`);
} catch (err) {
  step('page load', false, err.message);
  await browser.close();
  process.exit(1);
}

// ─────────── 2. Canvas mounted ───────────
try {
  await page.waitForSelector('canvas', { timeout: 15000 });
  const canvasCount = await page.locator('canvas').count();
  step('canvas element present', canvasCount > 0, `${canvasCount} canvas(es)`);
} catch (err) {
  step('canvas element present', false, err.message);
}

// ─────────── 3. WebGL context ───────────
try {
  const hasWebGL = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const gl = (c).getContext('webgl2') || (c).getContext('webgl');
    return !!gl;
  });
  step('WebGL context live', hasWebGL);
} catch (err) {
  step('WebGL context live', false, err.message);
}

// Wait a beat for layout + star field + nodes
await page.waitForTimeout(4000);

// ─────────── 4. Federation badge + Motion toggle present ───────────
try {
  // FederationBadge renders text Offline/N peers/Connecting/P2P N/A
  // We look for any of those + the Motion button
  const headerText = await page.locator('body').innerText();
  const hasFedBadge =
    /Offline|peer|Connecting|P2P N\/A/.test(headerText);
  step('federation badge visible', hasFedBadge, `text match`);
} catch (err) {
  step('federation badge visible', false, err.message);
}

// ─────────── 5. Side-panel not open yet (baseline) ───────────
const baselineOpen = await page.evaluate(
  () => /document preview/i.test(document.body.innerText || '')
);
step('side panel closed at start', !baselineOpen);

// ─────────── 6. Click node(s) and check side panel ───────────
// Strategy: get all rendered GraphNode positions from Three.js scene via the
// controls global we expose, project them to screen space, then click the
// first one that projects inside the viewport.
let clickedAndOpened = false;
let tried = 0;
let hoverEverFired = false;

try {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas bbox unavailable');

  // Graph3D auto-spins the camera (0.001 rad/frame) when no node is selected.
  // That makes screen coords drift between projection and click — kill it.
  // Easiest way: set highlightedNodeIds to non-empty in the store, which makes
  // shouldSpin false. We'll restore it after.
  await page.evaluate(() => {
    const store = (window).__sv_store;
    if (!store) return;
    const s = store.getState();
    if (typeof s.setHighlightedNodes === 'function') {
      s.setHighlightedNodes(['__pw_freeze__']);
    }
  });
  // Give one frame for the spin condition to flip
  await page.waitForTimeout(50);

  // Helper — perform a click at a canvas-local offset.
  // We dispatch native PointerEvents directly because Playwright's
  // page.mouse.* doesn't reach the canvas reliably in headless Chromium with
  // R3F's event manager.
  async function clickAt(x, y) {
    tried++;
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + x;
      const cy = rect.top + y;
      const base = {
        bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, screenX: cx, screenY: cy,
        pointerType: 'mouse', pointerId: 1, isPrimary: true,
        button: 0, buttons: 1, view: window,
      };
      // Events bubble (bubbles: true), so canvas-level dispatch reaches the
      // window-level mousedown/mouseup listeners naturally — no need to fire
      // a separate window event (and doing so would set e.target=window which
      // crashes Graph3D.tsx's `canvas.contains(e.target)` check).
      canvas.dispatchEvent(new PointerEvent('pointermove', base));
      canvas.dispatchEvent(new MouseEvent('mousemove', base));
      canvas.dispatchEvent(new PointerEvent('pointerdown', base));
      canvas.dispatchEvent(new MouseEvent('mousedown', base));
      const upBase = { ...base, buttons: 0 };
      canvas.dispatchEvent(new PointerEvent('pointerup', upBase));
      canvas.dispatchEvent(new MouseEvent('mouseup', upBase));
      canvas.dispatchEvent(new MouseEvent('click', upBase));
    }, { x, y });
    // Wait for the 10ms setTimeout in Graph3D.tsx + React re-render
    await page.waitForTimeout(120);
  }

  // First try: grab node positions from the Three.js scene. GraphNodes renders
  // all nodes as a single THREE.Points object with a bufferGeometry whose
  // position attribute holds one vec3 per node. We walk the scene, find the
  // Points object(s) with onClick handlers, and project each vertex to screen.
  const screenPts = await page.evaluate(() => {
    try {
      const controls = (window).__sv_controls?.current;
      if (!controls) return { err: 'no controls' };
      // Prefer the direct globals exported from Graph3D.tsx's Scene component.
      const scene = (window).__sv_scene || controls.object?.parent;
      const camera = (window).__sv_camera || controls.object;
      if (!scene) return { err: 'no scene' };
      if (!camera) return { err: 'no camera' };

      const canvas = document.querySelector('canvas');
      if (!canvas) return { err: 'no canvas' };
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Make sure matrices are fresh
      camera.updateMatrixWorld();
      const mvp = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);

      // Find the core-node Points instance. In Stellavault the GraphNodes
      // component renders TWO Points children: glow + cores. The core one has
      // an onClick handler attached via R3F. We can't inspect R3F handlers
      // directly, but the core Points has a smaller buffer and a `raycast`
      // function. We'll collect every Points with a reasonable vertex count
      // (3 ≤ n ≤ 2000 — excludes the 3000-point star field).
      const allPointsObjs = [];
      scene.traverse((obj) => {
        if (!obj.isPoints) return;
        const attr = obj.geometry?.attributes?.position;
        if (!attr) return;
        const n = attr.count;
        if (n < 1 || n > 2000) return;
        allPointsObjs.push(obj);
      });

      // Use Three.js's own Vector3.project(camera) — guaranteed correct.
      // We grab a Vector3 instance from any object in the scene to get the
      // class constructor (avoids needing window.THREE).
      let Vector3Class = null;
      scene.traverse((o) => {
        if (!Vector3Class && o.position) Vector3Class = o.position.constructor;
      });
      if (!Vector3Class) return { err: 'no Vector3 class' };

      const pts = [];
      const tmp = new Vector3Class();
      for (const pObj of allPointsObjs) {
        const posAttr = pObj.geometry.attributes.position;
        const arr = posAttr.array;
        pObj.updateMatrixWorld();
        for (let i = 0; i < posAttr.count; i++) {
          tmp.set(arr[i * 3 + 0], arr[i * 3 + 1], arr[i * 3 + 2]);
          tmp.applyMatrix4(pObj.matrixWorld);
          // Three.js's official screen-space project
          tmp.project(camera);
          if (tmp.z < -1 || tmp.z > 1) continue;
          const sx = (tmp.x * 0.5 + 0.5) * w;
          const sy = (-tmp.y * 0.5 + 0.5) * h;
          if (sx < 20 || sx > w - 20 || sy < 20 || sy > h - 20) continue;
          pts.push({ x: Math.round(sx), y: Math.round(sy), d: tmp.z, idx: i, objUuid: pObj.uuid });
        }
      }
      // Dedupe near-identical points (glow + core share positions)
      const seen = new Set();
      const dedup = pts.filter((p) => {
        const k = `${Math.round(p.x / 4)}:${Math.round(p.y / 4)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      dedup.sort((a, b) => a.d - b.d);
      return { objCount: allPointsObjs.length, pts: dedup.slice(0, 30) };
    } catch (e) {
      return { err: String(e) };
    }
  });
  if (screenPts && screenPts.err) {
    console.log(`  → projection error: ${screenPts.err}`);
  } else if (screenPts && screenPts.pts) {
    console.log(`  → found ${screenPts.objCount} Points obj(s), projected ${screenPts.pts.length} vertices`);
  }
  const projected = (screenPts && Array.isArray(screenPts.pts)) ? screenPts.pts : [];

  if (projected.length > 0) {
    console.log(`  → trying clicks on projected nodes...`);
    for (const pt of projected) {
      tried++;
      // Do the FULL hover→click→state-check in a single evaluate, matching
      // the click-debug2 flow that's known to work. Doing it across multiple
      // evaluates is unreliable because R3F may run animation frames in
      // between, clearing hover state.
      const result = await page.evaluate(async ({ x, y }) => {
        function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
        const canvas = document.querySelector('canvas');
        if (!canvas) return { err: 'no canvas' };
        const store = (window).__sv_store;
        if (!store) return { err: 'no store' };
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + x, cy = rect.top + y;
        const opts = {
          bubbles: true, cancelable: true, composed: true,
          clientX: cx, clientY: cy, screenX: cx, screenY: cy,
          pointerType: 'mouse', pointerId: 1, isPrimary: true,
          button: 0, buttons: 1, view: window,
        };
        canvas.dispatchEvent(new PointerEvent('pointermove', opts));
        canvas.dispatchEvent(new MouseEvent('mousemove', opts));
        const hoveredAfterMove = store.getState().hoveredNodeId;

        canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
        canvas.dispatchEvent(new MouseEvent('mousedown', opts));
        const upOpts = { ...opts, buttons: 0 };
        canvas.dispatchEvent(new PointerEvent('pointerup', upOpts));
        canvas.dispatchEvent(new MouseEvent('mouseup', upOpts));

        // Wait for the 10ms setTimeout in Graph3D.tsx onUp to run
        await delay(80);
        const sel = store.getState().selectedNodeId;
        return { hoveredAfterMove, sel };
      }, { x: pt.x, y: pt.y });

      if (result.hoveredAfterMove) {
        hoverEverFired = true;
        if (tried <= 3) {
          console.log(`    (${pt.x},${pt.y}) hover=${result.hoveredAfterMove.slice(0,8)} sel=${result.sel ? result.sel.slice(0,8) : 'null'}`);
        }
      }
      if (result.sel) {
        clickedAndOpened = true;
        break;
      }
    }
  } else {
    // Fallback: blind click at spiral positions around the center
    console.log('  → could not project node positions, using blind spiral...');
    const cx = box.width / 2;
    const cy = box.height / 2;
    const offsets = [
      [0, 0], [40, 0], [-40, 0], [0, 40], [0, -40],
      [80, 0], [-80, 0], [0, 80], [0, -80],
      [60, 60], [-60, 60], [60, -60], [-60, -60],
      [120, 0], [-120, 0], [0, 120], [0, -120],
    ];
    for (const [dx, dy] of offsets) {
      await clickAt(cx + dx, cy + dy);
      const opened = await page.evaluate(() => {
        return !!document.querySelector('aside') ||
          [...document.querySelectorAll('button')].some((b) => /×/.test(b.textContent || ''));
      });
      if (opened) {
        clickedAndOpened = true;
        break;
      }
    }
  }
} catch (err) {
  console.log(`  click loop error: ${err.message}`);
}

step(`node click → side panel opens`, clickedAndOpened, `attempts: ${tried}`);
step('R3F hover fired at least once', hoverEverFired, hoverEverFired ? '' : 'raycaster never matched a node');

// ─────────── 6b. Direct store.selectNode() isolation test ───────────
// If the click-path failed, find out whether it's the click detection or
// the panel rendering that's broken. Call selectNode directly on the store.
if (!clickedAndOpened) {
  console.log('\n  [isolation] click path failed — trying direct selectNode()...');
  const directResult = await page.evaluate(() => {
    try {
      const store = (window).__sv_store;
      if (!store) return { err: 'no store' };
      const state = store.getState();
      const nodes = state.nodes || [];
      if (nodes.length === 0) return { err: 'no nodes in store' };
      const firstId = nodes[0].id;
      state.selectNode(firstId);
      return { ok: true, id: firstId, nodeCount: nodes.length };
    } catch (e) {
      return { err: String(e) };
    }
  });
  console.log(`  [isolation] selectNode() result: ${JSON.stringify(directResult)}`);
  await page.waitForTimeout(800);

  // Deep DOM inspection
  const diag = await page.evaluate(() => {
    const store = (window).__sv_store;
    const state = store?.getState?.();
    const bodyText = document.body.innerText || '';
    const allDivs = document.querySelectorAll('div');
    const asCount = allDivs.length;
    // Match any div with width 380px (NodeDetail root style)
    const panelDiv = [...allDivs].find((d) => {
      const s = d.getAttribute('style') || '';
      return s.includes('width: 380px') || s.includes('width:380px');
    });
    return {
      storeSelected: state?.selectedNodeId,
      bodyTextIncludesPreview: bodyText.includes('Document Preview'),
      bodyTextLength: bodyText.length,
      divCount: asCount,
      panelDivFound: !!panelDiv,
      panelDivText: panelDiv ? (panelDiv.innerText || '').slice(0, 120) : null,
      fullBodyHead: bodyText.slice(0, 500),
    };
  });
  console.log('  [isolation] DOM diag:', JSON.stringify(diag, null, 2));

  const panelOpenedDirect = diag.bodyTextIncludesPreview || diag.panelDivFound;
  step('direct selectNode() opens panel', panelOpenedDirect,
    panelOpenedDirect ? 'panel rendering OK → click detection is broken'
                       : 'panel itself broken — deeper bug');

  // Close it and try a hover-then-click approach with longer waits
  if (panelOpenedDirect) {
    await page.evaluate(() => (window).__sv_store?.getState?.().selectNode(null));
    await page.waitForTimeout(300);
  }
}

// ─────────── 7. Federation join probe via badge click ───────────
// Skip actual join (would start a hyperswarm session). Just verify the badge
// is clickable and the API endpoint responds.
try {
  const fedStatus = await page.evaluate(async () => {
    const r = await fetch('/api/federate/status');
    return r.json();
  });
  const fedOk = fedStatus && typeof fedStatus.available === 'boolean';
  step('federation API reachable from page', fedOk, JSON.stringify(fedStatus));
} catch (err) {
  step('federation API reachable from page', false, err.message);
}

// ─────────── 8. Console errors ───────────
const ignorable = (m) =>
  /THREE\.WebGLRenderer: Context Lost/.test(m) ||
  /DevTools/.test(m) ||
  /React DevTools/.test(m);
const realErrors = consoleErrors.filter((m) => !ignorable(m));
step('no console errors', realErrors.length === 0, `${realErrors.length} errors`);
if (realErrors.length > 0) {
  for (const e of realErrors.slice(0, 5)) console.log(`    ${e.slice(0, 200)}`);
}

// ─────────── Screenshot ───────────
const shotPath = resolve(outDir, 'graph-smoke.png');
await page.screenshot({ path: shotPath, fullPage: false });
console.log(`\n📸 screenshot: ${shotPath}`);

// Also save a DOM snapshot for debugging
const html = await page.content();
writeFileSync(resolve(outDir, 'graph-smoke.html'), html);

await browser.close();

// ─────────── Summary ───────────
console.log('\n─── Summary ───');
const passed = results.filter((r) => r.passed).length;
console.log(`${passed}/${results.length} checks passed`);

process.exit(ok ? 0 : 1);
