// Screenshots of the static preview (preview.html, from make-preview.mjs) at a phone and a desktop width, through
// Playwright's preinstalled Chromium. Serves the repository root on a local port; supplier pictures are served from
// MORLEVI_IMGS (a folder of <code>.jpg) when set, else they fail and the cards show their grey box.
// Usage: MORLEVI_IMGS=/path/to/imgs node .github/pc-builder/screenshot.cjs [out-dir]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const repo = path.join(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'screenshots'));
const imgs = process.env.MORLEVI_IMGS;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const file = path.join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(repo) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function shoot(browser, base, name, width, height, steps) {
  const page = await browser.newPage({
    reducedMotion: 'reduce', viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 600, isMobile: width < 600 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    const code = decodeURIComponent(route.request().url().split('/').pop());
    const file = imgs && path.join(imgs, code);
    if (file && fs.existsSync(file)) route.fulfill({ path: file, contentType: 'image/jpeg' });
    else route.abort();
  });
  let cartBody = null;
  await page.route('**/cart/add.js', (route) => {
    cartBody = JSON.parse(route.request().postData());
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
  await page.route('**/cart', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>cart</p>' }));
  await page.goto(`${base}/.github/pc-builder/preview.html${steps.query || ''}`);
  await page.waitForSelector('.pcb--ready', { timeout: 15000 });
  for (const step of steps.actions || []) await step(page);
  await page.waitForTimeout(400);
  // Lazy pictures below the fold never load: wait for the visible ones, at most 3 seconds.
  await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 3000)), Promise.all([...document.images].filter((i) => !i.complete && i.getBoundingClientRect().top < innerHeight).map((i) => new Promise((r) => { i.onload = i.onerror = r; })))]));
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: steps.fullPage !== false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const small = await page.evaluate(() => [...document.querySelectorAll('.pcb button:not([disabled]), .pcb a, .pcb select, .pcb input')]
    .filter((el) => el.offsetParent && !el.closest('[hidden]'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width && (r.height < 24 || r.width < 24) && el.type !== 'radio' && el.type !== 'checkbox')
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`));
  console.log(`${name}: ${file}${overflow > 0 ? ` (horizontal overflow ${overflow}px)` : ''}`);
  if (small.length) console.log(`  small targets: ${small.slice(0, 8).join(', ')}`);
  if (errors.length) console.log(`  errors: ${errors.join(' | ')}`);
  if (steps.after) await steps.after(page, () => cartBody);
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const pickRecommended = async (page) => {
    await page.click('[data-action="use-build"][data-build="recommended"]');
  };
  try {
    const scrollTo = (sel) => async (p) => { await p.evaluate((s) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 12); }, sel); };
    await shoot(browser, base, 'phone-390-1-start', 390, 844, { fullPage: false });
    await shoot(browser, base, 'phone-390-2-builds', 390, 844, { actions: [scrollTo('.pcb-build--featured')], fullPage: false });
    await shoot(browser, base, 'phone-390-3-summary', 390, 844, { actions: [pickRecommended], fullPage: false });
    await shoot(browser, base, 'phone-390-4-step', 390, 844, {
      actions: [pickRecommended, async (p) => { await p.click('[data-action="toggle-summary"]'); await p.click('[data-mode-tab="steps"]'); await p.click('.pcb-steps__btn[data-step="board"]'); }, scrollTo('.pcb-stepnav')],
      fullPage: false,
    });
    await shoot(browser, base, 'phone-390-5-why', 390, 844, {
      actions: [pickRecommended, async (p) => { await p.click('[data-action="toggle-summary"]'); await p.click('[data-mode-tab="steps"]'); await p.click('.pcb-steps__btn[data-step="board"]'); await p.click('[data-action="toggle-blocked"]'); }, scrollTo('.pcb-blocked')],
      fullPage: false,
    });
    await shoot(browser, base, 'phone-390-full', 390, 844, {});
    await shoot(browser, base, 'desktop-1280-guided', 1280, 900, { actions: [pickRecommended] });
    await shoot(browser, base, 'desktop-1280-steps', 1280, 900, {
      query: '?mode=steps',
      actions: [async (p) => {
        await p.click('.pcb-part [data-action="choose"]');
        await p.selectOption('[data-filter="sort"]', 'price-asc');
      }],
      after: async (page, cart) => {
        // The cart call: one request, every part with the same _build_id and "הרכבה: כן".
        await page.click('.pcb-sum__panel [data-action="add-to-cart"]');
        await page.waitForTimeout(300);
        const body = cart();
        if (body) {
          const ids = new Set(body.items.map((i) => i.properties._build_id));
          console.log(`  cart: ${body.items.length} items, build ids ${[...ids].join(',')}, הרכבה=${body.items.every((i) => i.properties['הרכבה'] === 'כן')}`);
        }
      },
    });
  } finally {
    await browser.close();
    server.close();
  }
})();
