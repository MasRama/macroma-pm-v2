/*
 * Screenshots every harness screen in light and dark, at desktop 1440x900
 * and phone 390x844: <screen>-<light|dark>-<desk|phone>.png.
 * Usage: node tests/visual/shoot.cjs <out-dir> [screen,...]
 * Needs the harness dev server on :5611 and PLAYWRIGHT pointing at a
 * Playwright install (none is a repo dependency). Flags page overflow and
 * any dialog or menu that pokes out of the viewport.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const out = path.resolve(process.argv[2] || 'visual-shots');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const BASE = 'http://localhost:5611/';
const NOW = new Date('2026-11-17T10:20:00');

/** Clicks a trigger when the layout shows it (the phone board has no Bump versi button). */
const clickIfShown = (locator) => locator.isVisible().then((shown) => (shown ? locator.click() : undefined));

/** Screens, with the click that opens a menu screen. */
const SCREENS = [
  ['board'],
  ['task-detail'],
  ['new-task'],
  ['move-task'],
  ['confirm'],
  ['bump', (page) => clickIfShown(page.getByRole('button', { name: 'Bump versi' }))],
  ['notifications', (page) => clickIfShown(page.locator('.bell'))],
  ['releases'],
  ['dashboard'],
  ['workspace'],
  ['chat'],
  ['feed'],
  ['login'],
  ['profile'],
  ['not-found'],
];
const SHOTS = SCREENS.flatMap(([screen, act]) =>
  ['desk', 'phone'].flatMap((size) => ['light', 'dark'].map((theme) => [screen, theme, size, act])),
);

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
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')]
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.left < 0 || box.right > window.innerWidth + 0.5))
        .map(({ element }) => element.getAttribute('aria-label') || element.className),
    );
    const file = path.join(out, `${screen}-${theme}-${size}.png`);
    await page.screenshot({ path: file });
    const notes = [
      overflow ? '[horizontal overflow]' : '',
      clipped.length ? `[outside viewport: ${clipped.join(', ')}]` : '',
      errors.length ? `errors: ${errors.join(' | ')}` : '',
    ].filter(Boolean);
    console.log([file, ...notes].join('  '));
    await context.close();
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
