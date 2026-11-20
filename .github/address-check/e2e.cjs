// End to end in a browser, on a local page with the snippet (render.cjs, liquidjs) and mocks of /cart.js, the Storefront
// API and the checkout POST (server.cjs). Needs liquidjs and playwright: NODE_PATH=<their node_modules> THEME=<repo> node .github/address-check/e2e.cjs
const { chromium } = require('playwright');
const start = require('./server.cjs');
const PORT = 8231, O = `http://localhost:${PORT}`;
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'ok' : 'FAIL', name, extra]); };
(async () => {
  const server = await start(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const reset = (fail) => page.request.get(`${O}/__reset${fail ? '?fail=1' : ''}`);
  const log = async () => (await page.request.get(`${O}/__log`)).json();
  const go = async (q = '') => { await page.goto(`${O}/${q}`); await page.waitForFunction(() => customElements.get('address-check')); };
  const field = (k) => page.locator(`[data-input="${k}"]`).first();
  const msg = (k) => page.locator(`[data-field="${k}"] [data-message]`).first();
  const checkout = () => page.locator('button[name="checkout"]').first().click();
  const reached = async () => { try { await page.waitForSelector('#reached', { timeout: 6000 }); return true; } catch { return false; } };

  // 1. Optional, empty: checkout goes on untouched, no API call.
  await reset(); await go();
  await checkout();
  let r = await reached(); let l = await log();
  ok('optional empty goes to checkout', r && l.checkout.length === 1 && l.graphql.length === 0, JSON.stringify(l));

  // 2. City in English, picked from the list; street with leading ה fixed; number from the street line.
  await reset(); await go();
  await field('city').fill('Haifa');
  await page.waitForSelector('[data-field="city"] [role="option"]');
  const firstCity = await page.locator('[data-field="city"] [role="option"]').first().textContent();
  ok('English city suggests חיפה', firstCity === 'חיפה', firstCity);
  await page.locator('[data-field="city"] [role="option"]').first().click();
  ok('city picked', (await field('city').inputValue()) === 'חיפה');
  await field('street').fill('הרצל 12');
  await page.waitForSelector('[data-field="street"] [role="option"]');
  await field('street').press('Escape');
  await field('extra').focus();
  await page.waitForTimeout(400);
  ok('number moved out of the street', (await field('street').inputValue()) === 'הרצל' && (await field('number').inputValue()) === '12', `${await field('street').inputValue()} / ${await field('number').inputValue()}`);
  await field('extra').fill('קומה 3 דירה 7');
  await checkout();
  r = await reached(); l = await log();
  const sent = l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress;
  ok('checked address sent and checkout reached', r && sent?.address1 === 'הרצל 12' && sent?.city === 'חיפה' && sent?.address2 === 'קומה 3 דירה 7' && sent?.countryCode === 'IL', JSON.stringify(sent));
  ok('cart id from /cart.js', l.graphql[0]?.variables?.id === 'gid://shopify/Cart/hWNtest?key=abc');

  // 3. The refused street "הגפן" in אלפי מנשה is put right to "גפן"; typed "קריית" city.
  await reset(); await go();
  await field('city').fill('אלפי מנשה'); await field('city').press('Enter');
  await field('street').fill('הגפן'); await field('number').fill('50');
  await checkout();
  r = await reached(); l = await log();
  const s3 = l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress;
  ok('הגפן → גפן on the label line', r && s3?.address1 === 'גפן 50', JSON.stringify(s3));

  // 4. Only a number in the street: blocked, message, no checkout.
  await reset(); await go();
  await field('city').fill('חיפה'); await field('city').press('Enter');
  await field('street').fill('7');
  await checkout();
  r = await reached(); l = await log();
  ok('street holding only a number is stopped', !r && l.checkout.length === 0 && (await field('number').inputValue()) === '7' && /רק מספר/.test(await msg('street').textContent()), await msg('street').textContent());
  ok('skip link shown', await page.locator('[data-skip]').isVisible());

  // 5. Missing house number: blocked.
  await reset(); await go();
  await field('city').fill('תל אביב'); await field('city').press('Enter');
  ok('תל אביב → תל אביב - יפו', (await field('city').inputValue()) === 'תל אביב - יפו', await field('city').inputValue());
  await field('street').fill('דיזנגוף');
  await checkout();
  r = await reached();
  ok('missing number is stopped', !r && /חסר מספר בית/.test(await msg('number').textContent()), await msg('number').textContent());

  // 6. Unknown street: blocked, then "keep as typed" lets it through as typed.
  await reset(); await go();
  await field('city').fill('חיפה'); await field('city').press('Enter');
  await field('street').fill('רחוב שאין כמותו'); await field('number').fill('3');
  await checkout();
  r = await reached();
  ok('unknown street is stopped', !r && /לא נמצא/.test(await msg('street').textContent()), await msg('street').textContent());
  await page.locator('[data-keep="street"]').click();
  await checkout();
  r = await reached(); l = await log();
  ok('kept as typed goes on', r && l.graphql.at(-1)?.variables?.a?.[0]?.address?.deliveryAddress?.address1 === 'רחוב שאין כמותו 3');

  // 7. Skip: clears and goes to checkout.
  await reset(); await go();
  await field('city').fill('עיר שלא קיימת'); await checkout();
  r = await reached();
  ok('unknown city stopped', !r && /לא מצאנו/.test(await msg('city').textContent()));
  await page.locator('[data-skip]').click();
  r = await reached(); l = await log();
  ok('skip goes to checkout without an address', r && l.graphql.length === 0);

  // 8. Storefront API down: checkout still goes on (fail open).
  await reset(true); await go();
  await field('city').fill('חיפה'); await field('city').press('Enter');
  await field('street').fill('הרצל'); await field('number').fill('1');
  await checkout();
  r = await reached();
  ok('API failure fails open', r);

  // 9. Required mode, empty: blocked.
  await reset(); await go('?mode=required');
  await checkout();
  r = await reached();
  ok('required empty is stopped', !r && /נא למלא/.test(await page.locator('[data-status]').first().textContent()));

  // 10. Kibbutz: no streets, label changes, no number needed.
  await reset(); await go();
  await field('city').fill('אביטל'); await field('city').press('Enter');
  await page.waitForTimeout(300);
  const lbl = await page.locator('[data-field="street"] [data-label]').first().textContent();
  await checkout();
  r = await reached(); l = await log();
  ok('kibbutz: street optional, address1 is the locality', r && lbl.includes('אם יש') && l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress?.address1 === 'אביטל', lbl + ' ' + JSON.stringify(l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress));

  // 11. Drawer form (box inside the form), Enter in a field never submits.
  await reset(); await go('?ctx=drawer');
  await page.locator('summary').first().click();
  await field('city').fill('ירושלים'); await field('city').press('Enter');
  await field('street').fill('יפו'); await field('street').press('Enter');
  await page.waitForTimeout(300);
  l = await log();
  ok('Enter in the drawer does not submit', l.checkout.length === 0);
  await field('number').fill('97'); await checkout();
  r = await reached(); l = await log();
  ok('drawer checkout with address', r && l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress?.address1 === 'יפו 97', JSON.stringify(l.graphql[0]?.variables?.a?.[0]?.address?.deliveryAddress));

  // Screenshots (OUT=<folder>): a stopped address at phone and desktop widths.
  await reset(); await go();
  await field('city').fill('חיפה'); await field('city').press('Enter');
  await field('street').fill('הרצלל'); await field('number').fill('');
  await checkout(); await page.waitForTimeout(400);
  if (process.env.OUT) await page.screenshot({ path: `${process.env.OUT}/address-check-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await go(); await field('city').fill('קרי'); await page.waitForTimeout(400);
  if (process.env.OUT) await page.screenshot({ path: `${process.env.OUT}/address-check-1280.png`, fullPage: true });

  ok('no script errors', errors.length === 0, errors.join(' | '));
  for (const x of results) console.log(x.join('  '));
  await browser.close(); server.close();
  process.exit(results.some((x) => x[0] === 'FAIL') ? 1 : 0);
})();
