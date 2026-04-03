import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 1. 노드 찾아서 호버만 (클릭 없이)
for (let dx = -250; dx <= 250; dx += 20) {
  for (let dy = -200; dy <= 200; dy += 20) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(30);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    if (cursor === 'pointer') {
      console.log(`Node at [${dx}, ${dy}] — hovering (no click)`);
      await page.waitForTimeout(1500);

      const result = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasPreview: text.includes('Document Preview') || text.includes('DOCUMENT PREVIEW'),
          hasExplore: text.includes('Explore connections'),
          snippet: text.slice(0, 300),
        };
      });
      console.log('Hover result:', JSON.stringify(result, null, 2));

      // 2. 마우스를 빈 곳으로 이동 → 패널 사라지는지
      await page.mouse.move(cx + 250, cy + 200);
      await page.waitForTimeout(800);
      const afterLeave = await page.evaluate(() => {
        return document.body.innerText.includes('Document Preview');
      });
      console.log('After leave:', afterLeave ? 'Panel still visible' : 'Panel hidden');

      await page.waitForTimeout(2000);
      await browser.close();
      process.exit(0);
    }
  }
}

console.log('No node found');
await browser.close();
