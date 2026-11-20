// The e2e page (e2e.cjs): the rendered snippet in a cart form, the theme's assets, and mocks that record what the
// element sends: GET /cart.js, POST /api/2026-01/graphql.json (or a 500 after /__reset?fail=1) and the checkout POST.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const render = require('./render.cjs');
const theme = process.env.THEME;
const log = { graphql: [], checkout: [] };
let failApi = false;
const types = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
module.exports = function start(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    if (url.pathname === '/') {
      const mode = url.searchParams.get('mode') || 'optional';
      const ctx = url.searchParams.get('ctx') || 'page';
      const snippet = await render(mode, ctx, ctx === 'page' ? 'CartForm' : '');
      const inner = `<div style="padding:16px;max-width:${ctx === 'drawer' ? 420 : 520}px;margin:auto">${ctx === 'page' ? '<form id="CartForm" action="/cart" method="post"><input type="hidden" name="note" value=""></form>' + snippet + '<button class="button button--accent button--full" type="submit" name="checkout" form="CartForm" style="margin-top:12px">המשך לתשלום</button>' : '<form id="DrawerForm" action="/cart" method="post" style="display:flex;flex-direction:column">' + snippet + '<button class="button button--accent button--full" type="submit" name="checkout" style="margin-top:12px">המשך לתשלום</button></form>'}</div>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="he" dir="rtl" class="js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="importmap">{"imports":{"@theme/address-match":"/assets/address-match.js"}}</script>
<link rel="stylesheet" href="/assets/base.css"><style>:root{--color-background:#fff;--color-ink:#060433;--color-text:#333;--color-muted:#666;--color-brand:#309d7a;--color-hover-bg:#e0fff2;--color-error:#b42318;--color-border:#ddd;--color-border-control:#999;--radius-card:8px;--radius-input:8px;--radius-badge:6px;--space-2xs:4px;--space-xs:8px;--space-sm:12px;--space-md:16px;--text-xs:12px;--text-sm:14px;--leading-snug:1.35;--duration-fast:150ms;--ease-out:ease-out} body{font-family:sans-serif}</style></head><body>${inner}</body></html>`);
    }
    if (url.pathname === '/cart.js') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"token":"hWNtest?key=abc","item_count":1}'); }
    if (url.pathname === '/api/2026-01/graphql.json') {
      log.graphql.push(JSON.parse(body));
      if (failApi) { res.writeHead(500); return res.end('no'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"data":{"cartDeliveryAddressesReplace":{"userErrors":[]}}}');
    }
    if (url.pathname === '/cart/update.js') { log.update = (log.update || []).concat(JSON.parse(body)); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (url.pathname === '/cart' && req.method === 'POST') { log.checkout.push(body); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<p id="reached">CHECKOUT_REACHED</p>'); }
    if (url.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log)); }
    if (url.pathname === '/__reset') { log.graphql = []; log.checkout = []; log.update = []; failApi = url.searchParams.get('fail') === '1'; res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/assets/')) {
      const f = path.join(theme, 'assets', path.basename(url.pathname));
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(port, () => r(server)));
};
