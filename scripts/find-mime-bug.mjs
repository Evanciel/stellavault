import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('sv_onboarding_done', 'true'); } catch {} });
page.on('console', (m) => {
  if (m.type() === 'error') {
    console.log('ERR:', m.text());
    const loc = m.location();
    console.log('  loc:', loc.url + ':' + loc.lineNumber);
  }
});
await page.goto('http://127.0.0.1:3333/', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
await browser.close();
