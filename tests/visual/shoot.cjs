/*
 * Screenshots every harness screen: desktop 1440x900 (light and dark) and
 * phone 390x844. Usage: node tests/visual/shoot.cjs <out-dir> [screen,...]
 * Needs the harness dev server on :5611 and PLAYWRIGHT pointing at a
 * Playwright install (none is a repo dependency).
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const out = path.resolve(process.argv[2] || 'visual-shots');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const BASE = 'http://localhost:5611/';
const NOW = new Date('2026-11-17T10:20:00');

const SHOTS = [
  ['board', 'light', 'desk'],
  ['task-detail', 'light', 'desk'],
  ['new-task', 'light', 'desk'],
  ['move-task', 'light', 'desk'],
  ['confirm', 'light', 'desk'],
  ['bump', 'light', 'desk', (page) => page.getByRole('button', { name: 'Bump versi' }).click()],
  ['notifications', 'light', 'desk', (page) => page.locator('.bell').click()],
  ['releases', 'light', 'desk'],
  ['dashboard', 'light', 'desk'],
  ['workspace', 'light', 'desk'],
  ['chat', 'light', 'desk'],
  ['feed', 'light', 'desk'],
  ['login', 'light', 'desk'],
  ['profile', 'light', 'desk'],
  ['not-found', 'light', 'desk'],
  ['board', 'dark', 'desk'],
  ['dashboard', 'dark', 'desk'],
  ['task-detail', 'dark', 'desk'],
  ['board', 'light', 'phone'],
  ['dashboard', 'light', 'phone'],
  ['login', 'light', 'phone'],
  ['workspace', 'light', 'phone'],
];

const PROFILE = { id: '1', name: 'Ren', email: 'ren@wajom.co', avatar: null, revision: 1 };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  });
  for (const [screen, theme, size, act] of SHOTS) {
    if (only && !only.includes(screen)) continue;
    const phone = size === 'phone';
    const context = await browser.newContext({
      viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: phone ? 2 : 1.5,
      hasTouch: phone,
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.route('**/api/users/me', (route) =>
      route.fulfill({ json: { success: true, message: 'Profile loaded.', data: { user: PROFILE } } }),
    );
    await page.route('**/api/auth/**', (route) => route.fulfill({ status: 401, json: { success: false, message: 'Not signed in.', code: 'UNAUTHENTICATED' } }));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${BASE}?screen=${screen}&theme=${theme}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (act) await act(page);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const file = path.join(out, `${screen}-${theme}-${size}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}${overflow ? '  [horizontal overflow]' : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`);
    await context.close();
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
