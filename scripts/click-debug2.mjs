import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('sv_onboarding_done', 'true'); } catch {} });
await page.goto('http://127.0.0.1:3333/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(4000);

// Freeze
await page.evaluate(() => window.__sv_store.getState().setHighlightedNodes(['__freeze__']));
await page.waitForTimeout(50);

// Find a hover-successful position by trying many
const result = await page.evaluate(async () => {
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  const store = window.__sv_store;
  const camera = window.__sv_camera;
  const scene = window.__sv_scene;
  const canvas = document.querySelector('canvas');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const rect = canvas.getBoundingClientRect();

  // Project all node points
  let Vector3 = null;
  scene.traverse(o => { if (!Vector3 && o.position) Vector3 = o.position.constructor; });
  const tmp = new Vector3();
  const allPts = [];
  scene.traverse(o => {
    if (!o.isPoints) return;
    const attr = o.geometry?.attributes?.position;
    if (!attr || attr.count > 200) return;
    o.updateMatrixWorld();
    for (let i = 0; i < attr.count; i++) {
      tmp.set(attr.array[i*3], attr.array[i*3+1], attr.array[i*3+2]);
      tmp.applyMatrix4(o.matrixWorld);
      tmp.project(camera);
      const sx = (tmp.x * 0.5 + 0.5) * w;
      const sy = (-tmp.y * 0.5 + 0.5) * h;
      if (sx > 50 && sx < w-50 && sy > 50 && sy < h-50) {
        allPts.push({ x: Math.round(sx), y: Math.round(sy), uuid: o.uuid });
      }
    }
  });

  // Try each until one hovers
  let goodPt = null;
  for (const pt of allPts) {
    const cx = rect.left + pt.x, cy = rect.top + pt.y;
    const opts = { bubbles: true, cancelable: true, composed: true,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy,
      pointerType: 'mouse', pointerId: 1, isPrimary: true,
      button: 0, buttons: 1, view: window };
    canvas.dispatchEvent(new PointerEvent('pointermove', opts));
    await delay(20);
    if (store.getState().hoveredNodeId) {
      goodPt = { ...pt, hov: store.getState().hoveredNodeId };
      break;
    }
  }

  if (!goodPt) return { err: 'no hover ever fired across ' + allPts.length + ' positions' };

  // Now do a full click sequence on the good point
  const log = [];
  const cx = rect.left + goodPt.x, cy = rect.top + goodPt.y;
  const opts = { bubbles: true, cancelable: true, composed: true,
    clientX: cx, clientY: cy, screenX: cx, screenY: cy,
    pointerType: 'mouse', pointerId: 1, isPrimary: true,
    button: 0, buttons: 1, view: window };

  log.push({ at: 'before click sequence', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  canvas.dispatchEvent(new PointerEvent('pointermove', opts));
  log.push({ at: 'after pointermove', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
  log.push({ at: 'after pointerdown', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  canvas.dispatchEvent(new MouseEvent('mousedown', opts));
  log.push({ at: 'after mousedown', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  const upOpts = { ...opts, buttons: 0 };
  canvas.dispatchEvent(new PointerEvent('pointerup', upOpts));
  log.push({ at: 'after pointerup', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  canvas.dispatchEvent(new MouseEvent('mouseup', upOpts));
  log.push({ at: 'after mouseup', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  await delay(50);
  log.push({ at: '+50ms', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });
  await delay(200);
  log.push({ at: '+250ms', sel: store.getState().selectedNodeId, hov: store.getState().hoveredNodeId });

  return { goodPt, log };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
