import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

for (let dx = -250; dx <= 250; dx += 20) {
  for (let dy = -200; dy <= 200; dy += 20) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(30);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    if (cursor === 'pointer') {
      console.log(`Node at [${dx}, ${dy}]`);

      // 클릭
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(1500);

      // 확인
      const result = await page.evaluate(() => {
        const text = document.body.innerText;
        const has380 = !!Array.from(document.querySelectorAll('div')).find(d => d.style.width === '380px');
        return {
          hasPanel: has380,
          hasPreview: text.includes('DOCUMENT PREVIEW') || text.includes('Document Preview'),
          hasExplore: text.includes('Explore connections'),
        };
      });
      console.log('Result:', JSON.stringify(result));

      if (result.hasPanel) {
        console.log('SUCCESS - Panel is visible!');
        await page.screenshot({ path: 'success.png', fullPage: true });
      } else {
        console.log('FAIL - Panel not found');

        // 디버그: selectedNodeId 확인
        const debug = await page.evaluate(() => {
          // zustand 내부 상태에 접근할 수 없으므로 DOM 기반으로 확인
          return {
            allText: document.body.innerText.slice(0, 300),
            divCount: document.querySelectorAll('div').length,
          };
        });
        console.log('Debug:', JSON.stringify(debug, null, 2));
      }

      await page.waitForTimeout(2000);
      await browser.close();
      process.exit(0);
    }
  }
}

console.log('No node found');
await browser.close();
