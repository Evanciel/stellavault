import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log('1. Opening graph...');
await page.goto('http://localhost:5173');
await page.waitForTimeout(3000);

// 페이지 상태 확인
const statusText = await page.locator('body').innerText();
console.log('2. Page text:', statusText.slice(0, 200));

// 콘솔 로그 캡처
page.on('console', msg => {
  if (msg.type() === 'error') console.log('  [CONSOLE ERROR]', msg.text());
});

// zustand store 상태 확인
const storeState = await page.evaluate(() => {
  // zustand store 직접 접근 시도
  const root = document.getElementById('root');
  return {
    rootExists: !!root,
    rootChildren: root?.children?.length ?? 0,
    rootHTML: root?.innerHTML?.slice(0, 500) ?? 'empty',
  };
});
console.log('3. Root state:', JSON.stringify(storeState, null, 2));

// selectedNodeId 상태 확인
const graphState = await page.evaluate(() => {
  try {
    // window에 노출된 함수로 상태 확인
    return {
      hasPulse: typeof window.__sv_pulse === 'function',
      hasStopPulse: typeof window.__sv_stopPulse === 'function',
    };
  } catch (e) {
    return { error: String(e) };
  }
});
console.log('4. Graph functions:', JSON.stringify(graphState));

// Canvas 요소 확인
const canvasInfo = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return {
    canvasExists: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
  };
});
console.log('5. Canvas:', JSON.stringify(canvasInfo));

// 노드 호버 시뮬레이션: 캔버스 중앙 근처로 마우스 이동
const canvasBounds = await page.locator('canvas').boundingBox();
if (canvasBounds) {
  const cx = canvasBounds.x + canvasBounds.width / 2;
  const cy = canvasBounds.y + canvasBounds.height / 2;

  console.log('6. Moving mouse to canvas center:', cx, cy);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(500);

  // 호버 후 상태
  const afterHover = await page.evaluate(() => {
    // DOM에서 사이드패널 찾기
    const panels = document.querySelectorAll('div');
    let sidePanel = null;
    panels.forEach(p => {
      if (p.style.width === '380px') sidePanel = p;
    });
    return {
      panelFound: !!sidePanel,
      totalDivs: panels.length,
    };
  });
  console.log('7. After hover:', JSON.stringify(afterHover));

  // 클릭
  console.log('8. Clicking...');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(1000);

  // 클릭 후 상태
  const afterClick = await page.evaluate(() => {
    const panels = document.querySelectorAll('div');
    let sidePanel = null;
    let sidePanelText = '';
    panels.forEach(p => {
      if (p.style.width === '380px') {
        sidePanel = p;
        sidePanelText = p.innerText?.slice(0, 100) ?? '';
      }
    });

    // zustand 상태 직접 확인 — React 내부 접근
    const allText = document.body.innerText;
    const hasDocPreview = allText.includes('Document Preview');
    const hasExplore = allText.includes('Explore connections');

    return {
      panelFound: !!sidePanel,
      sidePanelText,
      hasDocPreview,
      hasExplore,
      bodyTextSnippet: allText.slice(0, 300),
    };
  });
  console.log('9. After click:', JSON.stringify(afterClick, null, 2));

  // 여러 위치에서 클릭 시도 (노드가 있을만한 곳)
  for (const offset of [[0, 0], [-100, -50], [100, 50], [-50, 80], [80, -60]]) {
    const x = cx + offset[0];
    const y = cy + offset[1];
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);

    const cursorStyle = await page.evaluate(() => document.body.style.cursor);
    if (cursorStyle === 'pointer') {
      console.log(`10. Found node at offset [${offset}]! Clicking...`);
      await page.mouse.click(x, y);
      await page.waitForTimeout(1000);

      const result = await page.evaluate(() => {
        return {
          bodyText: document.body.innerText.slice(0, 500),
          has380Panel: !!Array.from(document.querySelectorAll('div')).find(d => d.style.width === '380px'),
        };
      });
      console.log('11. After node click:', JSON.stringify(result, null, 2));
      break;
    }
  }
}

await page.waitForTimeout(3000);
await browser.close();
console.log('Done.');
