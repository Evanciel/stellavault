import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on('console', m => console.log(`[${m.type()}]`, m.text()));
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 1. 노드 찾아서 클릭
let nodeX = 0, nodeY = 0;
for (let dx = -250; dx <= 250; dx += 15) {
  for (let dy = -200; dy <= 200; dy += 15) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(20);
    if (await page.evaluate(() => document.body.style.cursor) === 'pointer') {
      nodeX = cx + dx; nodeY = cy + dy;
      break;
    }
  }
  if (nodeX) break;
}
console.log('Node at', nodeX - cx, nodeY - cy);

// 클릭 → 패널 열기
await page.mouse.move(nodeX, nodeY);
await page.waitForTimeout(200);
await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
await page.waitForTimeout(1500);

const panelOpen = await page.evaluate(() => document.body.innerText.includes('Explore connections'));
console.log('Panel open:', panelOpen);

if (panelOpen) {
  // 2. Explore 클릭
  console.log('Clicking Explore...');
  const btn = page.locator('button', { hasText: 'Explore connections' });
  await btn.click();

  // 3. 3초 동안 상태 모니터링
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => {
      const cv = document.querySelector('canvas');
      return {
        canvasVisible: cv ? cv.offsetWidth > 0 : false,
        bodyText: document.body.innerText.slice(0, 100),
      };
    });
    if (i % 3 === 0) console.log(`  tick ${i}: canvas=${state.canvasVisible}`);
  }

  // 4. 다른 노드 클릭 시도
  console.log('Trying to click another node...');
  let found2 = false;
  for (let dx = -200; dx <= 200; dx += 20) {
    for (let dy = -150; dy <= 150; dy += 20) {
      await page.mouse.move(cx + dx, cy + dy);
      await page.waitForTimeout(20);
      if (await page.evaluate(() => document.body.style.cursor) === 'pointer') {
        console.log('Found second node at', dx, dy);
        await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
        await page.waitForTimeout(1000);

        const afterSecond = await page.evaluate(() => {
          const cv = document.querySelector('canvas');
          return {
            canvasVisible: cv ? cv.offsetWidth > 0 : false,
            canvasW: cv?.offsetWidth ?? 0,
            bodyText: document.body.innerText.slice(0, 150),
          };
        });
        console.log('After second click:', JSON.stringify(afterSecond));
        found2 = true;
        break;
      }
    }
    if (found2) break;
  }

  // 5. 빈 곳 클릭
  console.log('Clicking empty space...');
  await page.mouse.move(cx + 300, cy + 250);
  await page.waitForTimeout(200);
  await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up();
  await page.waitForTimeout(1000);

  const afterEmpty = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    return {
      canvasVisible: cv ? cv.offsetWidth > 0 : false,
      canvasW: cv?.offsetWidth ?? 0,
    };
  });
  console.log('After empty click:', JSON.stringify(afterEmpty));
}

await page.waitForTimeout(2000);
await browser.close();
