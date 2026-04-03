import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

await page.screenshot({ path: '../../../images/before-click.png' });
console.log('1. Before click screenshot saved');

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 노드 찾기
for (let dx = -250; dx <= 250; dx += 20) {
  for (let dy = -200; dy <= 200; dy += 20) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(30);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    if (cursor === 'pointer') {
      console.log(`2. Node found at [${dx}, ${dy}], clicking...`);
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '../../../images/after-click.png' });
      console.log('3. After click screenshot saved');

      // DOM 디버그
      const debug = await page.evaluate(() => {
        const all = document.querySelectorAll('*');
        let panel = null;
        all.forEach(el => {
          if (el.textContent?.includes('DOCUMENT PREVIEW') && el.tagName === 'DIV') {
            const rect = el.getBoundingClientRect();
            panel = {
              tag: el.tagName,
              rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
              visible: rect.width > 0 && rect.height > 0,
              display: getComputedStyle(el).display,
              overflow: getComputedStyle(el).overflow,
              zIndex: getComputedStyle(el).zIndex,
            };
          }
        });
        return { panel, windowSize: { w: window.innerWidth, h: window.innerHeight } };
      });
      console.log('4. Panel debug:', JSON.stringify(debug, null, 2));

      await browser.close();
      process.exit(0);
    }
  }
}

console.log('No node found');
await browser.close();
