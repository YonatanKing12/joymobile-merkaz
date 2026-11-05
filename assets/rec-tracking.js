/* Which add to cart came from a recommendation, and which recommendations were seen.
 *
 * A recommendation surface is any element with [data-rec-source] (and [data-rec-anchor], the handle of
 * the product it was shown for); its tiles carry [data-rec-item]=<handle>. The surfaces and their names:
 *   product_addons  "השלימו את הערכה" on the product page (snippets/product-addons)
 *   cart_upsell     "להשלים את הערכה" in the cart drawer and on the cart page (snippets/cart-upsell)
 *   complementary   the related products row under the product page (sections/related-products)
 *
 * An add from a tile sends hidden line item properties: _rec_source, _rec_anchor and _rec_pos (the tile's
 * place in its row, from 1). Shopify hides properties that start with "_" in checkout, and so do the cart
 * lines here (snippets/cart-line). The dashboard reads them off the order lines.
 *
 * Two events for a custom pixel, through Shopify.analytics.publish (nothing else is loaded or sent):
 *   rec_viewed  once per surface per page, when it is on screen with at least one tile;
 *   rec_added   after a successful add, once per recommended line in it.
 * Nothing here changes what the shopper sees.
 */
const SURFACE = '[data-rec-source]';
const ITEM = '[data-rec-item]';
const seen = new Set();

function publish(name, payload) {
  try {
    window.Shopify?.analytics?.publish?.(name, payload);
  } catch {
    /* a pixel that fails must never break the add */
  }
}

/* The properties for an add made from `el` (a tile, its button or its checkbox); {} outside a surface. */
export function recProperties(el) {
  const surface = el?.closest?.(SURFACE);
  if (!surface) return {};
  const props = { _rec_source: surface.dataset.recSource };
  if (surface.dataset.recAnchor) props._rec_anchor = surface.dataset.recAnchor;
  const item = el.closest(ITEM);
  const list = item && (item.closest('[data-rec-list]') || surface);
  const pos = list ? [...list.querySelectorAll(ITEM)].indexOf(item) + 1 : 0;
  if (pos > 0) props._rec_pos = String(pos);
  return props;
}

/* After a successful /cart/add: one rec_added per line that came from a surface. */
export function recAdded(items) {
  for (const item of items || []) {
    const p = item?.properties;
    if (!p?._rec_source) continue;
    publish('rec_added', {
      source: p._rec_source,
      anchor: p._rec_anchor || null,
      position: Number(p._rec_pos) || null,
      variant_id: String(item.id ?? item.variant_id ?? ''),
      quantity: Number(item.quantity) || 1,
      page: location.pathname,
    });
  }
}

const shown = (el) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : !!el.offsetParent);

function check(surface) {
  const source = surface.dataset.recSource;
  if (!surface.isConnected || (source && seen.has(source))) return io?.unobserve(surface);
  if (!source || !surface.__recIn || !shown(surface)) return;
  const handles = [...surface.querySelectorAll(ITEM)].filter(shown).map((i) => i.dataset.recItem).filter(Boolean);
  if (!handles.length) return;
  seen.add(source);
  io?.unobserve(surface);
  publish('rec_viewed', { source, anchor: surface.dataset.recAnchor || null, items: handles.slice(0, 12), page: location.pathname });
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.__recIn = entry.isIntersecting;
      check(entry.target);
    }
  }, { threshold: [0, 0.25, 0.5, 1] })
  : null;

/* Watch every surface under `root` that is not watched yet, and look again at the ones on screen (their
   tiles may just have arrived). Surfaces fill and re-render on their own, so they call this too. */
export function recScan(root = document) {
  if (!io) return;
  const list = [...(root.matches?.(SURFACE) ? [root] : []), ...root.querySelectorAll(SURFACE)];
  for (const surface of list) {
    if (!surface.__recWatched) {
      surface.__recWatched = true;
      io.observe(surface);
    } else check(surface);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => recScan());
else recScan();
document.addEventListener('shopify:section:load', (e) => recScan(e.target));
