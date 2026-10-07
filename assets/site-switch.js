// @theme/site-switch. Moving between the two JOY Mobile sites (snippets/site-switch.liquid) keeps
// the visitor where they were: the link to the same page on the other site (data-keep) gets this
// page's query (filters, sort, page; not ?variant, whose ids differ per shop), the chosen variant's
// SKU and the scroll position, carried in the fragment (#joy-at&y=…&sku=…). On arrival the other
// site turns the SKU back into its own ?variant=, scrolls to the same spot and drops the fragment.
const MARK = 'joy-at';

function carry(link) {
  const url = new URL(link.dataset.href || link.href, location.href);
  const params = new URLSearchParams(location.search);
  const variant = params.get('variant');
  params.delete('variant');
  if (params.toString()) url.search = params.toString();

  const state = new URLSearchParams({ y: String(Math.round(scrollY)) });
  if (variant && link.dataset.skus) {
    try {
      const sku = JSON.parse(link.dataset.skus)[variant];
      if (sku) state.set('sku', sku);
    } catch {}
  }
  url.hash = `${MARK}&${state}`;
  link.href = url.href;
}

// Before the browser follows the link: a click, a middle click, or a keyboard Enter.
for (const type of ['click', 'auxclick']) {
  document.addEventListener(type, (event) => {
    const link = event.target.closest?.('a.site-switch__opt--there[data-keep]');
    if (link) carry(link);
  }, true);
}

async function arrive() {
  const match = location.hash.match(new RegExp(`^#${MARK}&(.*)$`));
  if (!match) return;
  const state = new URLSearchParams(match[1]);
  history.replaceState(history.state, '', location.pathname + location.search);

  // The other site's variant, by SKU: reload once on it, keeping the scroll position.
  const sku = state.get('sku');
  const handle = location.pathname.match(/\/products\/([^/?#]+)/)?.[1];
  if (sku && handle && !new URLSearchParams(location.search).has('variant')) {
    try {
      const res = await fetch(`${window.Shopify?.routes?.root || '/'}products/${handle}.js`);
      const product = res.ok ? await res.json() : null;
      const variant = product?.variants?.find((v) => v.sku === sku);
      const shown = product?.variants?.find((v) => v.available) || product?.variants?.[0];
      if (variant && variant.id !== shown?.id) {
        const params = new URLSearchParams(location.search);
        params.set('variant', variant.id);
        location.replace(`${location.pathname}?${params}#${MARK}&y=${state.get('y') || 0}`);
        return;
      }
    } catch {}
  }

  const y = Number(state.get('y')) || 0;
  if (!y) return;
  // Scroll now and again as images and late sections settle, until the visitor scrolls themselves.
  let stopped = false;
  const stop = () => { stopped = true; };
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(type, stop, { once: true, passive: true });
  const go = () => { if (!stopped) scrollTo({ top: y, behavior: 'instant' }); };
  go();
  if (document.readyState !== 'complete') addEventListener('load', go, { once: true });
  setTimeout(go, 400);
  setTimeout(go, 1200);
}

arrive();
