import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

const canvas = await page.locator('canvas').boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;

// 1. 노드 찾기
let nodeX = 0, nodeY = 0;
for (let dx = -250; dx <= 250; dx += 15) {
  for (let dy = -200; dy <= 200; dy += 15) {
    await page.mouse.move(cx + dx, cy + dy);
    await page.waitForTimeout(20);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    if (cursor === 'pointer') {
      nodeX = cx + dx;
      nodeY = cy + dy;
      console.log(`1. Node found at [${dx}, ${dy}]`);
      break;
    }
  }
  if (nodeX) break;
}

if (!nodeX) { console.log('No node found'); await browser.close(); process.exit(1); }

// 2. 호버 상태 확인 (툴팁만, 사이드패널 없음)
await page.mouse.move(nodeX, nodeY);
await page.waitForTimeout(500);
let result = await page.evaluate(() => ({
  hasPanel: document.body.innerText.includes('Document Preview'),
  bodySnippet: document.body.innerText.slice(0, 200),
}));
console.log(`2. Hover only — panel: ${result.hasPanel}`);

// 3. 클릭 (mousedown + mouseup at same position)
await page.mouse.move(nodeX, nodeY);
await page.waitForTimeout(200);
await page.mouse.down();
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(1500);

result = await page.evaluate(() => ({
  hasPanel: document.body.innerText.includes('Document Preview'),
  hasExplore: document.body.innerText.includes('Explore connections'),
  snippet: document.body.innerText.slice(0, 400),
}));
console.log(`3. After click — panel: ${result.hasPanel}, explore: ${result.hasExplore}`);
if (result.hasPanel) console.log('   Content:', result.snippet.slice(200, 400));

// 4. 빈 곳 클릭 → 해제
await page.mouse.move(cx + 300, cy + 250);
await page.waitForTimeout(200);
await page.mouse.down();
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(800);

result = await page.evaluate(() => ({
  hasPanel: document.body.innerText.includes('Document Preview'),
}));
console.log(`4. After empty click — panel: ${result.hasPanel}`);

// 5. 같은 노드 다시 클릭 → 열기
await page.mouse.move(nodeX, nodeY);
await page.waitForTimeout(300);
await page.mouse.down();
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(1500);

result = await page.evaluate(() => ({
  hasPanel: document.body.innerText.includes('Document Preview'),
}));
console.log(`5. Re-click node — panel: ${result.hasPanel}`);

// 6. 같은 노드 또 클릭 → 토글 닫기
await page.mouse.move(nodeX, nodeY);
await page.waitForTimeout(300);
await page.mouse.down();
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(800);

result = await page.evaluate(() => ({
  hasPanel: document.body.innerText.includes('Document Preview'),
}));
console.log(`6. Toggle off — panel: ${result.hasPanel}`);

console.log('\nDone!');
await page.waitForTimeout(2000);
await browser.close();
