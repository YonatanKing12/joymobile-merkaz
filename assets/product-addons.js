/* "השלימו את הערכה" — snippets/product-addons.liquid (the shell) + sections/product-addons.liquid (tiles).
 *
 * The product's own buttons are the add-ons' buttons. Ticked tiles ride along with the device: the
 * product form (assets/product.js) asks this element for selectedItems() and sends the device and
 * every ticked accessory in one /cart/add call, then calls clear(). While something is ticked the
 * section root carries [data-pa-count] and --pa-count, which the buy buttons read for their "+N"
 * badge — on the section root because the buttons themselves are re-rendered on every variant change.
 * Only when the device is sold out does this element add on its own (its standalone button).
 *
 * Each panel carries a search query. The panel's tiles are the same section rendered against
 * /search for that query, so the matching happens in Shopify's search index over the whole
 * catalogue instead of in Liquid over a collection the page cannot filter.
 *
 * Nothing is fetched until the module nears the viewport; then every group loads, one after another.
 * What fits differs per device and changes as stock comes and goes, so the card shapes itself to the
 * answer: a group that comes back empty loses its pill, the first group with tiles opens, and a
 * device with nothing to offer in any group shows no card at all. A page nobody scrolls costs nothing.
 *
 * Every price on a tile is server-rendered. The running total has to add numbers, so it cannot be,
 * and it is printed with the shop's own money_format string handed over in data-pa-money — which is
 * what the theme's "no money in JS" rule is actually protecting: a format that cannot drift from the
 * shop's. The authoritative total is still the cart drawer's, which the note under the sum says.
 */
import { define, on, sectionIdOf, searchSection } from '@theme/global';
import { addItems } from '@theme/cart';

const SECTION = 'product-addons';

class ProductAddons extends HTMLElement {
  connectedCallback() {
    /* The pills are found by [role=tablist], the attribute the markup must carry anyway. */
    this.tablist = this.querySelector('[role="tablist"]');
    this.panels = [...this.querySelectorAll('[data-pa-panel]')];
    this.bar = this.querySelector('[data-pa-bar]');
    this.submit = this.querySelector('[data-pa-submit]');
    this.label = this.querySelector('[data-pa-submit-label]');
    this.hint = this.querySelector('[data-pa-hint]');
    this.live = this.querySelector('[data-pa-live]');
    this.errorBox = this.querySelector('[data-pa-error]');
    if (!this.panels.length || !this.bar) return;

    this.str = this.bar.dataset;
    this.sectionId = sectionIdOf(this);
    this.root = this.closest('.shopify-section') || document.body;
    this.mainVariant = String(this.dataset.paMainVariant || '');
    this.base = Number(this.dataset.paBase) || 0;
    this.available = this.dataset.paAvailable !== 'false';
    this.moneyFormat = this.dataset.paMoney || '{{amount_no_decimals_with_comma_separator}} ₪';
    this.totalBox = this.querySelector('[data-pa-total]');
    this.subBox = this.querySelector('[data-pa-sub]');
    this.sumLabel = this.querySelector('[data-pa-sum-label]');
    this.chosenBox = this.querySelector('[data-pa-chosen]');

    /* ?addons=carousel or ?addons=grid on a product page URL shows that layout without saving it in
       the theme editor, so the two can be compared on the live store. */
    const asked = new URLSearchParams(location.search).get('addons');
    if (asked === 'carousel' || asked === 'grid') {
      this.classList.remove('pa--grid', 'pa--carousel');
      this.classList.add(`pa--${asked}`);
    }
    this.addEventListener('change', this);
    this.tablist?.addEventListener('click', this);
    this.tablist?.addEventListener('keydown', this);
    this.onSubmit = () => this.add();
    this.submit?.addEventListener('click', this.onSubmit);

    /* The device's price and availability follow the variant picker; the quantity follows the
       stepper. Both live outside this element, in regions the section re-renders. */
    this.offVariant = on('variant:changed', ({ detail: { variant, sectionId } }) => {
      if (sectionId !== this.sectionId || !variant) return;
      this.mainVariant = String(variant.id);
      this.base = Number(variant.price) || 0;
      this.available = variant.available !== false;
      this.refresh();
    });
    this.onQuantity = (e) => {
      if (e.target.matches?.('input[name="quantity"]')) this.refresh();
    };
    this.root.addEventListener('change', this.onQuantity);

    /* The page's own price (the large one by the buy buttons) shows the final price: device plus the
       ticked accessories, with a "כולל N אביזרים" line under it. Variant changes replace the price
       region after variant:changed has fired, so a childList observer on its live wrapper paints the
       new copy too. Only childList, so painting the amount does not re-trigger it. */
    this.priceLive = this.root.querySelector('.product__price-live');
    if (this.priceLive) {
      this.priceObserver = new MutationObserver(() => this.paintPrice());
      this.priceObserver.observe(this.priceLive, { childList: true });
    }

    /* The groups load when the module is near the viewport, not on page load. */
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this.observer.disconnect();
      this.loadAll();
    }, { rootMargin: '300px' });
    this.observer.observe(this);

    /* Carousel layout: the swipe hint shows only while the row is wider than the card, so four cards
       that all fit on a wide screen don't ask for a swipe. A hidden panel's row measures 0 and the
       observer fires again when its pill shows it or the window resizes. */
    this.rowObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => this.fitSwipe(entry.target.closest('[data-pa-panel]')));
    });
    this.panels.forEach((panel) => {
      const list = panel.querySelector('[data-pa-list]');
      if (list) this.rowObserver.observe(list);
    });
    this.refresh();
  }

  /* The card moves between the buy column and the space under the gallery when the window crosses
     992px (sections/main-product), which disconnects and reconnects it. A load aborted on the way
     must not stay 'pending', or load() would skip that panel for the rest of the visit. */
  disconnectedCallback() {
    this.observer?.disconnect();
    this.rowObserver?.disconnect();
    this.controllers?.forEach((c) => c.abort());
    this.controllers = [];
    this.panels?.forEach((panel) => {
      if (panel.dataset.paLoaded === 'pending') panel.dataset.paLoaded = '';
    });
    this.offVariant?.();
    this.root?.removeEventListener('change', this.onQuantity);
    this.priceObserver?.disconnect();
    this.submit?.removeEventListener('click', this.onSubmit);
    this.publish(0);
  }

  /* What the product form adds alongside the device. */
  selectedItems() {
    return this.checked.map((c) => ({ id: Number(c.closest('[data-pa-item]').dataset.paVariant), quantity: 1 }));
  }

  /* After a successful add: untick everything, so a second press adds the device alone. */
  clear() {
    this.checked.forEach((c) => { c.checked = false; });
    this.refresh();
    this.say(this.pick('paStrAdded'));
  }

  /* An add that failed part-way: the cart drawer already shows what really went in. */
  fail(message) {
    this.showError(message || this.str.paStrError);
  }

  get quantity() {
    const input = this.root.querySelector('input[name="quantity"]');
    return Math.max(1, Number(input?.value) || 1);
  }

  /* The badge on the buy buttons reads these from the section root, which survives the
     re-render of the button regions. */
  publish(n) {
    if (!this.root) return;
    this.root.toggleAttribute('data-pa-count', n > 0);
    if (n > 0) this.root.style.setProperty('--pa-count', String(n));
    else this.root.style.removeProperty('--pa-count');
  }

  say(text) {
    if (!this.live || !text) return;
    this.live.textContent = '';
    clearTimeout(this.sayTimer);
    this.sayTimer = setTimeout(() => { this.live.textContent = text; }, 120);
  }

  /* The sold-out wording when there is one ("…Solo" on the bar), else the usual string. */
  pick(key) {
    return (!this.available && this.str[`${key}Solo`]) || this.str[key] || '';
  }

  get allTabs() { return this.tablist ? [...this.tablist.querySelectorAll('[role="tab"]')] : []; }
  /* The pills a shopper can reach: a group with nothing for this device is gone from the row. */
  get tabs() { return this.allTabs.filter((tab) => !tab.hidden); }
  get checked() { return [...this.querySelectorAll('[data-pa-check]')].filter((c) => c.checked); }

  handleEvent(e) {
    if (e.type === 'change' && e.target.matches('[data-pa-check]')) {
      /* When it was ticked, so the chosen strip lists them in the order they were picked. */
      e.target.dataset.paAt = e.target.checked ? String(Date.now()) : '';
      return this.refresh();
    }
    if (e.type === 'click') {
      const tab = e.target.closest('[role="tab"]');
      if (tab) this.activate(tab, false);
      return;
    }
    /* RTL: ArrowLeft moves forward along the row, ArrowRight back. */
    const tabs = this.tabs;
    const i = tabs.indexOf(e.target.closest('[role="tab"]'));
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowLeft') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowRight') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    this.activate(next, true);
  }

  activate(tab, focus) {
    this.allTabs.forEach((other) => {
      const on = other === tab;
      other.setAttribute('aria-selected', on ? 'true' : 'false');
      other.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) this.load(panel);
  }

  /* Carousel layout: "4 אפשרויות · החליקו לעוד" under a row of cards that does not fit its width. */
  fitSwipe(panel) {
    const swipe = panel?.querySelector('[data-pa-swipe]');
    const list = panel?.querySelector('[data-pa-list]');
    if (!swipe || !list) return;
    const count = Number(panel.dataset.paCount) || 0;
    swipe.textContent = (this.str.paStrSwipe || '').replace('{count}', count);
    swipe.hidden = count < 2 || list.scrollWidth <= list.clientWidth + 1;
  }

  /* One retry on an empty answer. The search endpoint returns an empty result set under a burst of
     requests — measured: the same four queries came back 0, then 4 on every one of four later
     rounds. Without the retry a single blip would leave "no accessories" on a group that has four,
     for the rest of the visit, because the panel would already be marked loaded. */
  async load(panel, attempt = 0) {
    if (!panel || panel.dataset.paLoaded === 'true') return;
    if (attempt === 0 && panel.dataset.paLoaded === 'pending') return;
    panel.dataset.paLoaded = 'pending';
    const list = panel.querySelector('[data-pa-list]');
    const empty = panel.querySelector('[data-pa-empty]');
    const ctrl = new AbortController();
    (this.controllers ||= []).push(ctrl);

    try {
      const doc = await searchSection(panel.dataset.paQuery, SECTION, { signal: ctrl.signal });
      const items = [...doc.querySelectorAll('[data-pa-item]')]
        /* Never offer the phone that is already on the page. */
        .filter((li) => li.dataset.paVariant !== this.mainVariant && li.dataset.paHandle !== this.dataset.paHandle);
      if (!items.length && attempt < 1) {
        await new Promise((r) => setTimeout(r, 700));
        return this.load(panel, attempt + 1);
      }
      list.innerHTML = '';
      items.forEach((li) => list.appendChild(li));
      panel.dataset.paLoaded = 'true';
      panel.dataset.paCount = String(items.length);
      this.fitSwipe(panel);
      if (!items.length) {
        list.hidden = true;
        if (empty) empty.hidden = false;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 700));
        return this.load(panel, attempt + 1);
      }
      /* Left unmarked, so pressing the pill again tries once more. */
      panel.dataset.paLoaded = '';
      list.innerHTML = '';
      list.hidden = true;
      if (empty) empty.hidden = false;
    }
    this.prune();
    this.refresh();
  }

  /* Every group, one request at a time: the search endpoint answers a burst with empty sets (see
     load), and a group that wrongly came back empty would now lose its pill, not just show a note. */
  async loadAll() {
    for (const panel of this.panels) {
      if (!this.isConnected) return;
      await this.load(panel);
      /* A pill press (or prune opening the next group) may have started this one already. */
      while (panel.dataset.paLoaded === 'pending' && this.isConnected) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  /* Shape the card to what this device actually has. A group whose search came back empty loses its
     pill; if the open group is one of them, the first group that has tiles (or has not answered yet)
     opens instead. When every group has answered and none has a tile, the whole card goes. A group
     whose request failed keeps its pill and its note, so pressing it tries again. */
  prune() {
    const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls'));
    const isEmpty = (panel) => panel?.dataset.paLoaded === 'true' && panel.dataset.paCount === '0';
    this.allTabs.forEach((tab) => {
      if (!isEmpty(panelOf(tab))) return;
      tab.hidden = true;
      panelOf(tab).hidden = true;
      if (tab.getAttribute('aria-selected') === 'true') {
        tab.setAttribute('aria-selected', 'false');
        tab.tabIndex = -1;
      }
    });
    const visible = this.tabs;
    if (visible.length && !visible.some((tab) => tab.getAttribute('aria-selected') === 'true')) {
      const filled = visible.find((tab) => Number(panelOf(tab)?.dataset.paCount) > 0);
      this.activate(filled || visible[0], false);
    }
    const done = this.panels.every((panel) => panel.dataset.paLoaded === 'true');
    this.hidden = done && !visible.length;
    if (this.hidden) this.checked.forEach((c) => { c.checked = false; });
  }

  /* The shop's money_format, filled in. Only the four amount tokens Shopify defines are handled,
     which is every format a shop can be set to. */
  money(cents) {
    const fmt = (value, decimals, sep) => {
      const fixed = (value / 100).toFixed(decimals);
      const [whole, part] = fixed.split('.');
      const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
      return part ? `${grouped}.${part}` : grouped;
    };
    /* The page prints prices with money_without_trailing_zeros, so a whole amount loses its .00
       here too and the total matches every other price around it. */
    const strip = (text) => text.replace(/\.00(?=\D*$)/, '');
    return strip(this.moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) => {
      if (token === 'amount') return fmt(cents, 2, ',');
      if (token === 'amount_no_decimals') return fmt(cents, 0, ',');
      if (token === 'amount_with_comma_separator') return fmt(cents, 2, '.').replace(/\.(\d{2})$/, ',$1');
      if (token === 'amount_no_decimals_with_comma_separator') return fmt(cents, 0, '.');
      return fmt(cents, 0, ',');
    }));
  }

  /* The main price: the final total while accessories are ticked and the device is for sale, else the
     server-rendered price as it was (its markup is kept on the element and put back). Compare-at,
     saving and VAT lines describe the device alone, so they step aside while the total shows. */
  paintPrice() {
    const block = this.priceLive?.closest('.product__price');
    const amount = this.priceLive?.querySelector('.price__amount');
    if (!block || !amount) return;
    const on = this.available && this.priceCount > 0;
    if (amount.dataset.paHtml === undefined) amount.dataset.paHtml = amount.innerHTML;
    if (on) amount.textContent = this.money(this.priceTotal);
    else if (amount.innerHTML !== amount.dataset.paHtml) amount.innerHTML = amount.dataset.paHtml;
    block.classList.toggle('product__price--addons', on);
    let note = block.querySelector('.product__price-addons');
    if (!note) {
      note = document.createElement('p');
      note.className = 'product__price-addons';
      block.append(note);
    }
    note.hidden = !on;
    if (on) {
      const tpl = this.priceCount === 1 ? this.str.paStrPriceOne : this.str.paStrPriceMany;
      note.textContent = (tpl || '').replace('{count}', this.priceCount);
    }
  }

  refresh() {
    const n = this.checked.length;
    const standalone = !this.available;
    this.toggleAttribute('data-pa-standalone', standalone);
    if (this.submit) this.submit.disabled = n === 0;

    const extras = this.checked.reduce((sum, c) => sum + (Number(c.closest('[data-pa-item]').dataset.paPrice) || 0), 0);
    /* Sold out: the device is not part of the purchase, so the total is the accessories alone. */
    const base = standalone ? 0 : this.base * this.quantity;
    if (this.totalBox) this.totalBox.textContent = this.money(base + extras);
    this.priceTotal = base + extras;
    this.priceCount = n;
    this.paintPrice();

    /* Each pill carries how many of its own tiles are ticked, so a choice made in one group is still
       visible from the others. */
    this.tabs.forEach((tab) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      const box = tab.querySelector('[data-pa-tab-count]');
      if (!panel || !box) return;
      const picked = panel.querySelectorAll('[data-pa-check]:checked').length;
      box.textContent = picked ? String(picked) : '';
      box.hidden = picked === 0;
    });

    /* Sold out, the device is not part of the purchase: the copy drops "יחד עם המכשיר". */
    if (this.subBox) this.subBox.textContent = this.pick('paStrSub');
    if (this.sumLabel) {
      /* The carousel's total says what it adds up ("מכשיר + 2 אביזרים"); the grid keeps one label. */
      const carousel = this.classList.contains('pa--carousel') && !standalone;
      this.sumLabel.textContent = !carousel ? this.pick('paStrTotal')
        : n === 0 ? this.str.paStrCaptionNone
        : n === 1 ? this.str.paStrCaptionOne
        : this.str.paStrCaptionMany.replace('{count}', n);
    }
    this.paintChosen();
    const hint = n === 0 ? this.pick('paStrHintIdle')
      : n === 1 ? this.pick('paStrHintOne')
      : this.pick('paStrHintMany').replace('{count}', n);
    if (this.hint) this.hint.textContent = hint;
    if (this.label) {
      this.label.textContent = n === 0 ? this.str.paStrIdle
        : n === 1 ? this.str.paStrOne
        : this.str.paStrMany.replace('{count}', n);
    }
    this.publish(standalone ? 0 : n);
    if (n !== this.lastCount) {
      if (this.lastCount !== undefined && n > 0 && !standalone) this.say(hint);
      this.lastCount = n;
    }
    this.hideError();
  }

  /* The carousel's strip: one thumbnail button per ticked accessory, in the order they were ticked;
     pressing one unticks it. Rebuilt from the checkboxes on every refresh, so it cannot drift from
     them. The grid layout hides the strip, so it costs nothing there beyond this loop. */
  paintChosen() {
    const box = this.chosenBox;
    if (!box) return;
    const picked = this.checked
      .map((c) => ({ check: c, at: Number(c.dataset.paAt) || 0, item: c.closest('[data-pa-item]') }))
      .sort((a, b) => a.at - b.at);
    box.querySelectorAll('.pa__thumb').forEach((el) => el.remove());
    box.classList.toggle('pa__chosen--empty', picked.length === 0);
    const removeTpl = box.dataset.paStrRemove || '';
    picked.forEach(({ check, item }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pa__thumb';
      button.setAttribute('aria-label', removeTpl.replace('{title}', item.dataset.paTitle || ''));
      const source = item.querySelector('.pa-card__img');
      const img = document.createElement('img');
      img.className = 'pa__thumb-img';
      img.alt = '';
      img.src = source?.currentSrc || source?.src || '';
      if (source?.classList.contains('pa-card__img--fallback')) img.classList.add('pa__thumb-img--fallback');
      const x = document.createElement('span');
      x.className = 'pa__thumb-x';
      x.setAttribute('aria-hidden', 'true');
      button.append(img, x);
      button.addEventListener('click', () => {
        check.checked = false;
        check.dataset.paAt = '';
        this.refresh();
      });
      box.append(button);
    });
  }

  showError(message) {
    if (!this.errorBox) return;
    this.errorBox.textContent = message;
    this.errorBox.hidden = false;
  }

  hideError() {
    if (!this.errorBox) return;
    this.errorBox.hidden = true;
    this.errorBox.textContent = '';
  }

  /* The standalone button: only shown while the device is sold out. */
  async add() {
    const items = this.selectedItems();
    if (!items.length || !this.submit) return;

    this.submit.disabled = true;
    this.submit.setAttribute('aria-busy', 'true');
    if (this.label) this.label.textContent = this.str.paStrBusy;
    this.hideError();

    try {
      await addItems(items, { opener: this.submit });
      this.clear();
    } catch (error) {
      this.showError(error?.message || this.str.paStrError);
    } finally {
      this.submit.removeAttribute('aria-busy');
      this.refresh();
    }
  }
}

define('product-addons', ProductAddons);
