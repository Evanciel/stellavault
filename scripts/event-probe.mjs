import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1400, height: 900 } }).then(c => c.newPage());
await page.goto('http://127.0.0.1:3333/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(4000);

// What element is at the click point?
const probe = await page.evaluate(() => {
  const x = 700, y = 494;
  const el = document.elementFromPoint(x, y);
  if (!el) return { el: null };
  let path = el.tagName;
  let p = el.parentElement;
  while (p && path.split(' > ').length < 6) {
    path = p.tagName + ' > ' + path;
    p = p.parentElement;
  }
  // Walk up tree gathering elements that might be intercepting
  const elements = document.elementsFromPoint(x, y).map(e => ({
    tag: e.tagName,
    cls: (e.className || '').toString().slice(0, 60),
    style: (e.getAttribute('style') || '').slice(0, 100),
    pe: getComputedStyle(e).pointerEvents,
  }));
  return { topMost: { tag: el.tagName, path, style: el.getAttribute('style') }, stack: elements.slice(0, 6) };
});
console.log('elementFromPoint(700,494):');
console.log(JSON.stringify(probe, null, 2));

// Check canvas computed style
const canvasStyle = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const cs = getComputedStyle(c);
  return {
    pointerEvents: cs.pointerEvents,
    position: cs.position,
    zIndex: cs.zIndex,
    display: cs.display,
    visibility: cs.visibility,
    rect: c.getBoundingClientRect(),
  };
});
console.log('canvas style:', JSON.stringify(canvasStyle, null, 2));

await browser.close();
