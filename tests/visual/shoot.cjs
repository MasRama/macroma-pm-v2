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
  ['edit-task'],
  ['confirm'],
  ['bump', (page) => clickIfShown(page.getByRole('button', { name: 'Bump versi' }))],
  ['first-bump', (page) => clickIfShown(page.getByRole('button', { name: 'Bump versi' }))],
  ['notifications', (page) => clickIfShown(page.locator('.bell'))],
  ['releases'],
  ['dashboard'],
  ['workspace'],
  ['chat'],
  ['feed'],
  ['login'],
  ['register'],
  ['forgot-password'],
  ['reset-password'],
  ['profile'],
  ['users'],
  ['users-edit', (page) => page.locator('[data-testid^="edit-user-"]').nth(1).click()],
  ['not-found'],
];
const SHOTS = SCREENS.flatMap(([screen, act]) =>
  ['desk', 'phone'].flatMap((size) => ['light', 'dark'].map((theme) => [screen, theme, size, act])),
);

// A plain photo stand-in, so Profil shows Ganti foto and Hapus as in the mockup.
const PHOTO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2D55FF"/><circle cx="32" cy="26" r="11" fill="#fff"/><rect x="14" y="42" width="36" height="22" rx="11" fill="#fff"/></svg>')}`;
const PROFILE = { id: '1', name: 'Ren', email: 'ren@wajom.co', avatar: PHOTO, phone: '+62 812 3456 7890', verified: true, revision: 1 };
const ADMIN = { ...PROFILE, roles: ['admin'], permissions: [], mustChangePassword: false };
const person = (id, name, email, phone, verified, roles) => ({ id, name, email, avatar: null, phone, verified, roles, revision: 1 });
const USERS = [
  person('1', 'Ren', 'ren@wajom.co', '+62 812 3456 7890', true, ['admin']),
  person('2', 'Ayu Lestari', 'ayu@wajom.co', '0813 2222 1010', true, ['user']),
  person('3', 'Bima Pratama', 'bima@wajom.co', null, false, ['user']),
  person('4', 'Citra Dewi', 'citra@wajom.co', '0857 7000 3131', false, []),
  person('5', 'Dimas Saputra', 'dimas@studio.id', null, true, ['user']),
];
const ROLES = [
  { id: 'r1', name: 'Administrator', slug: 'admin', description: null, permissions: [] },
  { id: 'r2', name: 'User', slug: 'user', description: null, permissions: [] },
];
const json = (data) => (route) => route.fulfill({ json: { success: true, message: 'OK', data } });

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
    await page.route('**/api/events**', (route) => route.fulfill({ status: 204 }));
    if (screen.startsWith('users')) {
      await page.route('**/api/auth/me', json({ user: ADMIN }));
      await page.route((url) => url.pathname === '/api/users', json({ users: USERS, total: USERS.length, page: 1, limit: 10 }));
      await page.route('**/api/users/editing', json({ editing: { 4: [{ id: '2', name: 'Ayu Lestari' }] } }));
      await page.route('**/api/users/*/editing', json(undefined));
      await page.route('**/api/roles', json({ roles: ROLES }));
    }
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
