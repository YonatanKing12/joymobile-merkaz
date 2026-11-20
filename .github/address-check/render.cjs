// Renders snippets/address-check.liquid with liquidjs (THEME: the repository), for the e2e page (server.cjs).
const fs = require('node:fs');
const path = require('node:path');
const { Liquid, Tag } = require('liquidjs');
const theme = process.env.THEME;
const locale = JSON.parse(fs.readFileSync(path.join(theme, 'locales/he.default.json'), 'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/, ''));
const engine = new Liquid({ root: [path.join(theme, 'snippets')], extname: '.liquid', strictFilters: true });
engine.registerFilter('t', (key, ...args) => {
  const vars = Object.fromEntries(args.filter(Array.isArray));
  const v = key.split('.').reduce((o, k) => o?.[k], locale);
  if (v == null) return `[missing: ${key}]`;
  return String(v).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
});
engine.registerFilter('asset_url', (f) => `/assets/${f}?v=1`);
const swallow = (name) => engine.registerTag(name, class extends Tag {
  constructor(token, remain, liquid) { super(token, remain, liquid); while (remain.length) { const t = remain.shift(); if (t.name === `end${name}`) return; } }
  * render() { return ''; }
});
swallow('doc');
engine.registerTag('stylesheet', class extends Tag {
  constructor(token, remain, liquid) { super(token, remain, liquid); this.raw = ''; while (remain.length) { const t = remain.shift(); if (t.name === 'endstylesheet') return; this.raw += t.getText ? t.getText() : (t.raw || t.value || ''); } }
  * render(ctx, emitter) { emitter.write('<style>' + this.raw + '</style>'); }
});
module.exports = async function render(mode, context, form) {
  return engine.renderFile('address-check', { settings: { address_check_mode: mode }, context, form, class: context === 'drawer' ? 'cart-drawer__address' : '' });
};
if (require.main === module) module.exports(process.argv[2] || 'optional', 'page', 'CartForm').then((h) => console.log(h));
