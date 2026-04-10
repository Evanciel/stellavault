import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('sv_onboarding_done', 'true'); } catch {} });
await page.goto('http://127.0.0.1:3333/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(4000);

// Find a node position and click it, watching state at each step
const out = await page.evaluate(async () => {
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  const log = [];
  const store = window.__sv_store;
  log.push({step: 'init', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  // Freeze spin
  store.getState().setHighlightedNodes(['__freeze__']);
  await delay(50);
  log.push({step: 'frozen', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  // Get a node screen position
  const camera = window.__sv_camera;
  const scene = window.__sv_scene;
  const canvas = document.querySelector('canvas');
  const w = canvas.clientWidth, h = canvas.clientHeight;

  let picked = null;
  let Vector3 = null;
  scene.traverse(o => { if (!Vector3 && o.position) Vector3 = o.position.constructor; });
  const tmp = new Vector3();
  scene.traverse(o => {
    if (picked || !o.isPoints) return;
    const attr = o.geometry?.attributes?.position;
    if (!attr || attr.count > 200) return;
    o.updateMatrixWorld();
    for (let i = 0; i < attr.count; i++) {
      tmp.set(attr.array[i*3], attr.array[i*3+1], attr.array[i*3+2]);
      tmp.applyMatrix4(o.matrixWorld);
      tmp.project(camera);
      const sx = (tmp.x * 0.5 + 0.5) * w;
      const sy = (-tmp.y * 0.5 + 0.5) * h;
      if (sx > 100 && sx < w-100 && sy > 100 && sy < h-100) {
        picked = { x: Math.round(sx), y: Math.round(sy), idx: i };
        break;
      }
    }
  });

  log.push({step: 'picked', pt: picked});
  if (!picked) return { log, err: 'no point picked' };

  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + picked.x, cy = rect.top + picked.y;
  const opts = { bubbles: true, cancelable: true, composed: true,
    clientX: cx, clientY: cy, screenX: cx, screenY: cy,
    pointerType: 'mouse', pointerId: 1, isPrimary: true,
    button: 0, buttons: 1, view: window };

  // Move
  canvas.dispatchEvent(new PointerEvent('pointermove', opts));
  log.push({step: 'after move', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});
  await delay(20);
  log.push({step: 'after move +20ms', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  // Down
  canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
  canvas.dispatchEvent(new MouseEvent('mousedown', opts));
  log.push({step: 'after down', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  // Up
  const upOpts = { ...opts, buttons: 0 };
  canvas.dispatchEvent(new PointerEvent('pointerup', upOpts));
  canvas.dispatchEvent(new MouseEvent('mouseup', upOpts));
  log.push({step: 'after up', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  // Wait for the 10ms setTimeout in onUp
  await delay(50);
  log.push({step: 'after up +50ms', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  await delay(200);
  log.push({step: 'after up +250ms', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId});

  return { log };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
