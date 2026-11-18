// Screenshots of the static preview (preview.html, from make-preview.mjs) at a phone and a desktop width, through
// Playwright's preinstalled Chromium. Serves the repository root on a local port; supplier pictures are served from
// MORLEVI_IMGS (a folder of <code>.jpg) when set, else they fail and the cards show their grey box.
// Every file name starts with PREFIX (default "v2-"). Besides the pictures it checks, and prints, what must hold:
// horizontal overflow, targets under 44px on phones (24px elsewhere), script errors, the cart call, the strict
// compatibility rules on a shared link with a clashing pair, and a PDF of the printed quote.
// Usage: MORLEVI_IMGS=/path/to/imgs node .github/pc-builder/screenshot.cjs [out-dir]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const repo = path.join(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'screenshots'));
const imgs = process.env.MORLEVI_IMGS;
const prefix = process.env.PREFIX ?? 'v2-';
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
  if (steps.media) await page.emulateMedia({ media: steps.media });
  if (width >= 600) await page.mouse.move(1, 1); // no hover look left on the last button clicked
  // Lazy pictures below the fold never load: wait for the visible ones, at most 3 seconds.
  await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 3000)), Promise.all([...document.images].filter((i) => !i.complete && i.getBoundingClientRect().top < innerHeight).map((i) => new Promise((r) => { i.onload = i.onerror = r; })))]));
  const file = path.join(out, `${prefix}${name}.png`);
  await page.screenshot({ path: file, fullPage: steps.fullPage !== false });
  if (steps.pdf) await page.pdf({ path: path.join(out, `${prefix}${steps.pdf}`), format: 'A4', printBackground: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const min = width < 600 ? 44 : 24;
  const small = await page.evaluate((min) => [...document.querySelectorAll('.pcb button:not([disabled]), .pcb a, .pcb select, .pcb input, .pcb summary, .pcb-dialog button, .pcb-dialog a')]
    .filter((el) => el.getClientRects().length && !el.closest('[hidden]') && (!el.closest('dialog') || el.closest('dialog').open))
    .map((el) => ({ el, r: (el.type === 'radio' || el.type === 'checkbox' ? el.parentElement : el).getBoundingClientRect() }))
    .filter(({ el, r }) => r.width && (r.height < min - 0.5 || r.width < min - 0.5) && !el.classList.contains('visually-hidden') && el.type !== 'range')
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`), min);
  console.log(`${name}: ${file}${overflow > 0 ? ` (horizontal overflow ${overflow}px)` : ''}`);
  if (small.length) console.log(`  targets under ${min}px: ${[...new Set(small)].slice(0, 8).join(', ')}`);
  if (errors.length) console.log(`  errors: ${errors.join(' | ')}`);
  if (steps.after) await steps.after(page, () => cartBody);
  await page.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const phone = [390, 844];
  const desk = [1280, 900];
  const pickRecommended = async (page) => { await page.click('[data-action="use-build"][data-build="recommended"]'); };
  const closeSummary = async (p) => { if (await p.locator('.pcb--summary-open').count()) await p.click('[data-action="toggle-summary"]'); };
  const scrollTo = (sel, off = 12) => async (p) => { await p.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - o); }, [sel, off]); };
  const games = async (p) => {
    await p.check('input[name="game"][value="cs2"]');
    await p.check('input[name="game"][value="cyberpunk"]');
    await p.check('input[name="res"][value="1440p"]');
    await p.waitForTimeout(300);
  };
  const openMore = async (p) => {
    if (!(await p.locator('.pcb-more__list:not([hidden])').count())) await p.click('[data-action="toggle-more"]');
  };
  // Change the processor of the recommended build to an Intel one: the AM5/AM4 board must go, with a notice.
  const switchCpu = async (p) => {
    await pickRecommended(p);
    await closeSummary(p);
    await p.click('[data-mode-tab="steps"]');
    await p.click('.pcb-progress__step[data-step="cpu"]');
    await p.selectOption('[data-filter="brand"]', 'Intel');
    await p.locator('.pcb-row:has(.pcb-row__drop) [data-action="choose"]').first().click();
    await p.waitForTimeout(200);
  };
  const saveTwo = async (p) => {
    await pickRecommended(p);
    await openMore(p);
    await p.click('[data-action="save"]');
    await closeSummary(p);
    await p.click('[data-action="use-build"][data-build="power"]');
    await openMore(p);
    await p.click('[data-action="save"]');
    await openMore(p);
    await p.click('[data-action="compare"]');
  };
  const quote = async (p) => {
    await pickRecommended(p);
    await openMore(p);
    await p.click('[data-action="quote"]');
  };
  try {
    await shoot(browser, base, 'phone-390-1-start', ...phone, { fullPage: false });
    await shoot(browser, base, 'phone-390-2-games', ...phone, { actions: [games, scrollTo('.pcb-build.is-featured', 70)], fullPage: false });
    await shoot(browser, base, 'phone-390-3-summary', ...phone, { actions: [games, pickRecommended], fullPage: false });
    await shoot(browser, base, 'phone-390-4-step', ...phone, {
      actions: [pickRecommended, closeSummary, async (p) => { await p.click('[data-mode-tab="steps"]'); await p.click('.pcb-progress__step[data-step="board"]'); }, scrollTo('.pcb-progress', 76)],
      fullPage: false,
    });
    await shoot(browser, base, 'phone-390-5-change', ...phone, { actions: [switchCpu, scrollTo('.pcb-notice', 76)], fullPage: false });
    await shoot(browser, base, 'phone-390-6-why', ...phone, {
      actions: [pickRecommended, closeSummary, async (p) => { await p.click('[data-mode-tab="steps"]'); await p.click('.pcb-progress__step[data-step="board"]'); await p.click('[data-action="toggle-blocked"]'); }, scrollTo('.pcb-blocked', 76)],
      fullPage: false,
    });
    await shoot(browser, base, 'phone-390-7-quote', ...phone, { actions: [quote], fullPage: false });
    await shoot(browser, base, 'phone-390-8-compare', ...phone, { actions: [games, saveTwo], fullPage: false });
    await shoot(browser, base, 'phone-390-full', ...phone, { actions: [games] });
    await shoot(browser, base, 'desktop-1280-guided', ...desk, { actions: [games, pickRecommended] });
    await shoot(browser, base, 'desktop-1280-change', ...desk, { actions: [switchCpu, scrollTo('.pcb__tabs', 20)], fullPage: false });
    await shoot(browser, base, 'desktop-1280-steps', ...desk, {
      query: '?mode=steps',
      actions: [async (p) => {
        await p.click('.pcb-row [data-action="choose"]');
        await p.selectOption('[data-filter="sort"]', 'price-asc');
      }],
    });
    await shoot(browser, base, 'desktop-1280-quote', ...desk, { actions: [games, quote], fullPage: false });
    await shoot(browser, base, 'desktop-1280-quote-print', ...desk, { actions: [games, quote], media: 'print', pdf: 'quote.pdf' });
    await shoot(browser, base, 'desktop-1280-compare', ...desk, { actions: [games, saveTwo], fullPage: false });
    await shoot(browser, base, 'desktop-1280-cart', ...desk, {
      actions: [pickRecommended],
      fullPage: false,
      after: async (page, cart) => {
        // The cart call: one request, every part with the same _build_id and "הרכבה: כן".
        await page.click('.pcb-sum__panel [data-action="add-to-cart"]');
        await page.waitForTimeout(300);
        const body = cart();
        if (body) {
          const ids = new Set(body.items.map((i) => i.properties._build_id));
          console.log(`  cart: ${body.items.length} items, build ids ${[...ids].join(',')}, הרכבה=${body.items.every((i) => i.properties['הרכבה'] === 'כן')}`);
        } else console.log('  cart: NO REQUEST');
      },
    });
    // Strict: a shared link with an AM5 processor and an Intel board loads without the board, and cannot be ordered.
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/products.json'), 'utf8')).products;
    const find = (re) => fx.find((p) => re.test(p.title)).variants[0].id;
    const bad = [find(/Ryzen 7 9800X3D/), find(/Z890 EAGLE/), find(/^(זכרון|ז\.).*DDR4/)].join(',');
    await shoot(browser, base, 'phone-390-9-bad-link', ...phone, {
      query: `?build=${bad}`,
      fullPage: false,
      after: async (page) => {
        const state = await page.evaluate(() => ({
          notice: document.querySelector('[data-notice]:not([hidden])')?.textContent.trim().replace(/\s+/g, ' '),
          cart: document.querySelector('.pcb-sum__panel [data-action="add-to-cart"]').disabled,
          url: new URL(location.href).searchParams.get('build'),
        }));
        console.log(`  bad link: build=${state.url}, cart disabled=${state.cart}, notice: ${state.notice}`);
      },
    });
  } finally {
    await browser.close();
    server.close();
  }
})();
