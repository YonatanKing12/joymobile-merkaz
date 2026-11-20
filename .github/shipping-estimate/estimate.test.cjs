// snippets/shipping-estimate with liquidjs: the national store's delivery rule as the checkout charges it (20.11.2026).
// Run: npm i --no-save liquidjs@10 && node --test .github/shipping-estimate/estimate.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Liquid } = require('liquidjs');

const engine = new Liquid({ root: [path.join(__dirname, '../../snippets')], extname: '.liquid', strictFilters: true });
const settings = { cart_shipping_estimate: true, shipping_rate_regular: 39, shipping_free_from: 5000, shipping_rate_large: 89 };
const marked = { metafields: { shipping: { marks: '148825440625' } } };
const line = (shekels, large = false, ships = true) => ({
  final_line_price: Math.round(shekels * 100),
  requires_shipping: ships,
  variant: { metafields: { shipping: large ? { profile: '148825440625' } : {} } },
});
const run = (items, o = {}) =>
  engine.renderFileSync('shipping-estimate', { settings: { ...settings, ...o.settings }, shop: o.shop ?? marked, cart: { items, cart_level_discount_applications: o.discounts ?? [] } }).trim();

test('nothing until the dashboard has marked the large items, or with the setting off', () => {
  assert.equal(run([line(64)], { shop: { metafields: { shipping: {} } } }), '');
  assert.equal(run([line(64)], { settings: { cart_shipping_estimate: false } }), '');
});

test('the checkout rates of 20.11.2026', () => {
  assert.equal(run([line(64)]), '3900');
  assert.equal(run([line(1078, true)]), '8900');
  assert.equal(run([line(64), line(1078, true)]), '12800');
  assert.equal(run([line(5176)]), '0');
  assert.equal(run([line(5176), line(1078, true)]), '8900');
});

test('free shipping counts the whole order, large items included (the checkout gave 1,663 + 3,794 free regular delivery)', () => {
  assert.equal(run([line(1663), line(3794, true)]), '8900');
  assert.equal(run([line(5000)]), '0');
  assert.equal(run([line(4999.99)]), '3900');
});

test('never says free where the checkout may charge', () => {
  assert.equal(run([line(5100)], { discounts: [{ total_allocated_amount: 20000 }] }), '3900');
  assert.equal(run([line(4900), line(200, false, false)]), '3900');
  assert.equal(run([line(9000)], { settings: { shipping_free_from: 0 } }), '3900');
  assert.equal(run([line(117, false, false)]), '0');
});
