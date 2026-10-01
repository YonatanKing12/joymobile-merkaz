/* "להשלים את הערכה" inside the cart — snippets/cart-upsell + sections/cart-upsell.
 *
 * The shell carries one or two search queries derived from the cart's anchor line. The tiles are the
 * results section rendered against /search, so the matching happens in Shopify's index over the
 * whole catalogue rather than in Liquid over a collection the page cannot filter.
 *
 * Two things shape the code. First, every cart change re-renders the drawer and the cart page, so
 * this element is built from scratch several times a visit — results are cached per query at module
 * level, and only the first build of a query costs a request. Second, the block starts hidden and is
 * revealed only once it has a tile: an upsell that comes back empty should take no space at all,
 * least of all in a drawer.
 */
import { define, announce } from '@theme/global';
import { addItems } from '@theme/cart';

const SECTION = 'cart-upsell';
/* query -> [{ handle, variant, html }]. Survives the re-renders; a reload clears it. */
const cache = new Map();

async function search(query, attempt = 0) {
  if (cache.has(query)) return cache.get(query);
  const url = '/search?q=' + encodeURIComponent(query) +
    '&type=product&options%5Bprefix%5D=last&section_id=' + SECTION;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const items = [...doc.querySelectorAll('[data-cu-item]')].map((li) => ({
      handle: li.dataset.cuHandle,
      variant: li.dataset.cuVariant,
      html: li.outerHTML,
    }));
    /* The search endpoint returns an empty set under a burst of requests — the same queries that
       answer four come back 0 and then four again. One retry, then the answer is taken as real and
       cached, so a visit does not re-ask on every cart change. */
    if (!items.length && attempt < 1) {
      await new Promise((r) => setTimeout(r, 700));
      return search(query, attempt + 1);
    }
    cache.set(query, items);
    return items;
  } catch (error) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 700));
      return search(query, attempt + 1);
    }
    return []; // not cached: the next render tries again
  }
}

class CartUpsell extends HTMLElement {
  connectedCallback() {
    this.list = this.querySelector('[data-cu-list]');
    if (!this.list) return;
    this.queries = (this.dataset.cuQueries || '').split('|||').map((q) => q.trim()).filter(Boolean);
    this.skip = new Set((this.dataset.cuSkip || '').split(',').map((h) => h.trim()).filter(Boolean));
    this.limit = Number(this.dataset.cuLimit) || 4;
    this.addEventListener('click', this);
    this.fill();
  }

  async fill() {
    const picked = [];
    const seen = new Set();
    /* Queries in order, each topping the row up: the first is what nearly everyone adds, and the
       second only matters when the first does not fill it. A query that would add nothing is still
       asked for once and cached, which is what makes the next render free. */
    for (const query of this.queries) {
      if (picked.length >= this.limit) break;
      for (const item of await search(query)) {
        if (picked.length >= this.limit) break;
        if (this.skip.has(item.handle) || seen.has(item.handle)) continue;
        seen.add(item.handle);
        picked.push(item);
      }
    }
    if (!this.isConnected || !picked.length) return;
    this.list.innerHTML = picked.map((item) => item.html).join('');
    this.hidden = false;
  }

  async handleEvent(e) {
    const button = e.target.closest('[data-cu-add]');
    if (!button) return;
    const card = button.closest('[data-cu-item]');
    const id = Number(card?.dataset.cuVariant);
    if (!id || button.disabled) return;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      /* open: false — the drawer this sits in is already open, and on the cart page there is nothing
         to open. The re-render that follows rebuilds this element with the new line skipped. */
      await addItems([{ id, quantity: 1 }], { open: false });
      card.classList.add('is-added');
      announce(this.dataset.cuStrAdded || '');
    } catch (error) {
      button.disabled = false;
      announce(error?.message || this.dataset.cuStrError || '');
    } finally {
      button.removeAttribute('aria-busy');
    }
  }
}

define('cart-upsell', CartUpsell);
