import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(4000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 노드 찾기: 넓은 범위 스캔
let found = false;
for (let dx = -200; dx <= 200; dx += 30) {
  for (let dy = -150; dy <= 150; dy += 30) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(50);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    if (cursor === 'pointer') {
      console.log(`NODE FOUND at [${dx}, ${dy}]`);

      // 호버 확인
      await page.waitForTimeout(200);

      // 클릭 (pointerdown 방식)
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(1500);

      // 사이드패널 확인
      const result = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasPanel: text.includes('DOCUMENT PREVIEW') || text.includes('Document Preview'),
          hasExplore: text.includes('Explore connections'),
          snippet: text.slice(0, 400),
        };
      });
      console.log('PANEL:', JSON.stringify(result, null, 2));
      found = true;
      break;
    }
  }
  if (found) break;
}

if (!found) console.log('No node found in scan range');

await page.waitForTimeout(2000);
await browser.close();
