/* "להשלים את הערכה" inside the cart — snippets/cart-upsell + sections/cart-upsell.
 *
 * The shell carries one or two search queries derived from the cart's anchor line. The tiles are the
 * results section rendered against /search, so the matching happens in Shopify's index over the
 * whole catalogue rather than in Liquid over a collection the page cannot filter.
 *
 * Three things shape the code. First, the drawer is on every page, so its copy asks nothing until the
 * drawer opens; the cart page's copy fills at once. Second, every cart change re-renders the drawer
 * and the cart page, so this element is built from scratch several times a visit: requests are
 * shared per query at module level (the promise, so two copies asking at once make one request), and
 * only the first build of a query costs one. Third, the block starts hidden and is revealed only once
 * it has a tile: an upsell that comes back empty should take no space at all, least of all in a drawer.
 */
import { define, announce, searchSection } from '@theme/global';
import { addItems } from '@theme/cart';

const SECTION = 'cart-upsell';
/* query -> Promise<[{ handle, variant, html }]>. Survives the re-renders; a reload clears it. */
const cache = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(query, signal, attempt = 0) {
  try {
    const doc = await searchSection(query, SECTION, { signal });
    const items = [...doc.querySelectorAll('[data-cu-item]')].map((li) => ({
      handle: li.dataset.cuHandle,
      variant: li.dataset.cuVariant,
      html: li.outerHTML,
    }));
    /* The search endpoint returns an empty set under a burst of requests — the same queries that
       answer four come back 0 and then four again. One retry, then the answer is taken as real and
       kept, so a visit does not re-ask on every cart change. */
    if (!items.length && attempt < 1) {
      await wait(700);
      return request(query, signal, attempt + 1);
    }
    return items;
  } catch (error) {
    if (error.name === 'AbortError' || attempt >= 1) throw error;
    await wait(700);
    return request(query, signal, attempt + 1);
  }
}

/* One request per query, whoever asks: a second caller while it runs waits on the same promise. A
   request that fails or is abandoned leaves the cache, so the next render asks again. */
async function search(query, signal) {
  let pending = cache.get(query);
  if (!pending) {
    pending = request(query, signal);
    cache.set(query, pending);
    pending.catch(() => cache.get(query) === pending && cache.delete(query));
  }
  try {
    return await pending;
  } catch (error) {
    if (signal.aborted) throw error;
    /* Another copy's request, abandoned when that copy left the page: ask with this one's own. */
    if (error.name === 'AbortError') return search(query, signal);
    return [];
  }
}

class CartUpsell extends HTMLElement {
  connectedCallback() {
    this.list = this.querySelector('[data-cu-list]');
    if (!this.list) return;
    this.queries = (this.dataset.cuQueries || '').split('|||').map((q) => q.trim()).filter(Boolean);
    this.skip = new Set((this.dataset.cuSkip || '').split(',').map((h) => h.trim()).filter(Boolean));
    this.limit = Number(this.dataset.cuLimit) || 4;
    this.controller = new AbortController();
    this.addEventListener('click', this);

    /* The drawer opens three ways (the header link, an add to cart, the theme editor), and only the
       add announces itself with cart:open — so watch the drawer's own open attribute. A drawer that
       is re-rendered while open builds this element anew, and that copy fills at once. */
    const drawer = this.closest('cart-drawer');
    if (!drawer || drawer.hasAttribute('open')) {
      this.fill();
      return;
    }
    this.watcher = new MutationObserver(() => {
      if (!drawer.hasAttribute('open')) return;
      this.watcher.disconnect();
      this.fill();
    });
    this.watcher.observe(drawer, { attributes: true, attributeFilter: ['open'] });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this);
    this.watcher?.disconnect();
    this.controller?.abort();
  }

  async fill() {
    const picked = [];
    const seen = new Set();
    const { signal } = this.controller;
    /* Queries in order, each topping the row up: the first is what nearly everyone adds, and the
       second only matters when the first does not fill it. A query that would add nothing is still
       asked for once and kept, which is what makes the next render free. */
    try {
      for (const query of this.queries) {
        if (picked.length >= this.limit) break;
        for (const item of await search(query, signal)) {
          if (picked.length >= this.limit) break;
          if (this.skip.has(item.handle) || seen.has(item.handle)) continue;
          seen.add(item.handle);
          picked.push(item);
        }
      }
    } catch {
      return; // aborted: this copy has left the page
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
