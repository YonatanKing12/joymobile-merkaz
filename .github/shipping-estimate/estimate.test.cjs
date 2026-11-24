// snippets/shipping-estimate with liquidjs: the national store's delivery rule as the checkout charges it.
// Since 24.11.2026 (the owner): no free shipping; 39 ₪ regular, 49 ₪ "מוצרים בינוניים", 115 ₪ "מוצרים גדולים" and
// "טלוויזיות", each profile in the cart once, all added.
// Run: npm i --no-save liquidjs@10 && node --test .github/shipping-estimate/estimate.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Liquid } = require('liquidjs');

const engine = new Liquid({ root: [path.join(__dirname, '../../snippets')], extname: '.liquid', strictFilters: true });
const LARGE = '148825440625';
const MEDIUM = '148930593137';
const TV = '148971520369';
const settings = {
  cart_shipping_estimate: true,
  shipping_rate_regular: 39,
  shipping_free_from: 0,
  shipping_profile_rates: `${LARGE}:115,${MEDIUM}:49,${TV}:115`,
};
const marked = { metafields: { shipping: { marks: TV } } };
const line = (shekels, profile = null, ships = true) => ({
  final_line_price: Math.round(shekels * 100),
  requires_shipping: ships,
  variant: { metafields: { shipping: profile ? { profile } : {} } },
});
// settings and shop are Shopify globals: snippets/shipping-profile-rate, rendered from the estimate, reads them too.
const run = (items, o = {}) => {
  const globals = { settings: { ...settings, ...o.settings }, shop: o.shop ?? marked };
  return engine.renderFileSync('shipping-estimate', { cart: { items, cart_level_discount_applications: o.discounts ?? [] } }, { globals }).trim();
};

test('nothing until the dashboard has marked the profiles, or with the setting off', () => {
  assert.equal(run([line(64)], { shop: { metafields: { shipping: {} } } }), '');
  assert.equal(run([line(64)], { settings: { cart_shipping_estimate: false } }), '');
});

test('the checkout rates of 24.11.2026: no free shipping', () => {
  assert.equal(run([line(64)]), '3900');
  assert.equal(run([line(5176)]), '3900');
  assert.equal(run([line(9000), line(9000)]), '3900');
  assert.equal(run([line(1533, MEDIUM)]), '4900');
  assert.equal(run([line(2099, LARGE)]), '11500');
  assert.equal(run([line(4190, TV)]), '11500');
  assert.equal(run([line(64), line(1533, MEDIUM)]), '8800');
  assert.equal(run([line(64), line(2099, LARGE), line(4190, TV)]), '26900');
  assert.equal(run([line(64), line(1533, MEDIUM), line(2099, LARGE)]), '20300');
});

test('each profile once per order, whatever the number of its items', () => {
  assert.equal(run([line(1533, MEDIUM), line(944, MEDIUM)]), '4900');
  assert.equal(run([line(2099, LARGE), line(1078, LARGE), line(64)]), '15400');
});

test('an item of a profile the setting does not list: nothing, never a wrong figure', () => {
  assert.equal(run([line(64), line(500, '999999999999')]), '');
  assert.equal(run([line(1533, MEDIUM)], { settings: { shipping_profile_rates: `${LARGE}:115` } }), '');
});

test('a free threshold, if the owner sets one again, still counts the whole order and never says free where the checkout charges', () => {
  const free = { settings: { shipping_free_from: 5000 } };
  assert.equal(run([line(5176)], free), '0');
  assert.equal(run([line(1663), line(3794, LARGE)], free), '11500');
  assert.equal(run([line(4999.99)], free), '3900');
  assert.equal(run([line(5100)], { ...free, discounts: [{ total_allocated_amount: 20000 }] }), '3900');
  assert.equal(run([line(4900), line(200, null, false)], free), '3900');
});

test('nothing shipped: no delivery', () => {
  assert.equal(run([line(117, null, false)]), '0');
});
