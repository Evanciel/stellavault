import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on('console', m => { if (m.type() === 'error') console.log('ERR:', m.text()); });
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 노드 찾아서 클릭
for (let dx = -250; dx <= 250; dx += 15) {
  for (let dy = -200; dy <= 200; dy += 15) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(20);
    if (await page.evaluate(() => document.body.style.cursor) === 'pointer') {
      await page.waitForTimeout(200);
      await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
      await page.waitForTimeout(1500);

      // Explore 클릭
      const btn = page.locator('button', { hasText: 'Explore connections' });
      if (await btn.isVisible()) {
        console.log('Clicking Explore...');
        await btn.click();

        // 2초 동안 모니터링
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(200);
          const state = await page.evaluate(() => {
            const cv = document.querySelector('canvas');
            // 빛 입자가 있는지 확인 (mesh 개수 변화)
            return {
              canvasOK: cv ? cv.offsetWidth > 0 : false,
            };
          });
          if (i % 5 === 0) console.log(`  ${i * 200}ms: canvas=${state.canvasOK}`);
        }

        // 완료 후 다른 노드 클릭
        console.log('Clicking another node...');
        for (let dx2 = -100; dx2 <= 100; dx2 += 15) {
          for (let dy2 = -100; dy2 <= 100; dy2 += 15) {
            await page.mouse.move(cx + dx2, cy + dy2);
            await page.waitForTimeout(20);
            if (await page.evaluate(() => document.body.style.cursor) === 'pointer') {
              await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
              await page.waitForTimeout(1000);
              const ok = await page.evaluate(() => {
                const cv = document.querySelector('canvas');
                return { canvasW: cv?.offsetWidth ?? 0, hasPanel: document.body.innerText.includes('DOCUMENT PREVIEW') };
              });
              console.log('After 2nd click:', JSON.stringify(ok));
              break;
            }
          }
          break;
        }
      }
      await page.waitForTimeout(2000);
      await browser.close();
      process.exit(0);
    }
  }
}
await browser.close();
