// <address-check> (snippets/address-check): the delivery address in the cart, checked against Israel Post's lists
// before the checkout press, then set on the cart so Shopify fills it in at checkout.
//
// Safe by construction: an empty box in "optional" mode never touches the press; anything that fails here (a list
// that does not load, the Storefront API, a timeout) lets the press go on to checkout as before. The values live in
// this module, so the drawer's re-render (quantity, remove) and the cart page's copy show what was typed.
import { cityIndex, matchCity, searchCities, checkStreet, searchStreets, splitStreetLine, HOUSE_NUMBER } from '@theme/address-match';

const API = '/api/2026-01/graphql.json';
const TIMEOUT = 4000;
const FIELDS = ['city', 'street', 'number', 'extra'];
const memory = { city: '', street: '', number: '', extra: '', keep: { city: false, street: false } };

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const fill = (s, vars) => s.replace(/%(\w+)%/g, (_, k) => vars[k] ?? "");

let localities = null;
function loadLocalities(url) {
  localities ??= fetch(url, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => cityIndex(j.localities))
    .catch((err) => {
      localities = null;
      throw err;
    });
  return localities;
}
const shards = new Map();
function loadShard(url) {
  if (!shards.has(url)) {
    shards.set(
      url,
      fetch(url, { credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .catch((err) => {
          shards.delete(url);
          throw err;
        })
    );
  }
  return shards.get(url);
}

function withTimeout(promise, ms, controller) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error('timeout'));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The checked address on the cart, selected, for checkout to fill in. Resolves false on any failure. */
async function setCartAddress(address) {
  const controller = new AbortController();
  try {
    return await withTimeout(
      (async () => {
        const root = window.Shopify?.routes?.root || '/';
        const cart = await fetch(`${root}cart.js`, { signal: controller.signal, headers: { accept: 'application/json' } }).then((r) => r.json());
        if (!cart?.token) return false;
        const query = `mutation($id: ID!, $a: [CartSelectableAddressInput!]!) {
          cartDeliveryAddressesReplace(cartId: $id, addresses: $a) { userErrors { code } }
        }`;
        const variables = {
          id: `gid://shopify/Cart/${cart.token}`,
          a: [{ selected: true, oneTimeUse: true, validationStrategy: 'COUNTRY_CODE_ONLY', address: { deliveryAddress: { ...address, countryCode: 'IL' } } }],
        };
        const res = await fetch(API, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
        const json = await res.json();
        return res.ok && !json.errors && !json.data?.cartDeliveryAddressesReplace?.userErrors?.length;
      })(),
      TIMEOUT,
      controller
    );
  } catch {
    return false;
  }
}

class AddressCheck extends HTMLElement {
  connectedCallback() {
    this.mode = this.dataset.mode || 'optional';
    try {
      this.t = JSON.parse(this.querySelector('[data-address-strings]').textContent);
      this.shardUrls = JSON.parse(this.querySelector('[data-address-shards]').textContent);
    } catch {
      return;
    }
    this.details = this.querySelector('[data-address-details]');
    this.status = this.querySelector('[data-status]');
    this.skip = this.querySelector('[data-skip]');
    this.inputs = Object.fromEntries(FIELDS.map((k) => [k, this.querySelector(`[data-input="${k}"]`)]));
    for (const k of FIELDS) if (memory[k]) this.inputs[k].value = memory[k];
    if (FIELDS.some((k) => memory[k])) this.details.open = true;
    this.active = { city: -1, street: -1 };

    this.addEventListener('input', this);
    this.addEventListener('keydown', this);
    this.addEventListener('focusin', this);
    this.addEventListener('focusout', this);
    this.addEventListener('mousedown', this);
    this.addEventListener('click', this);

    // Opened in the drawer: the city field comes into view above the sticky totals.
    this.details.addEventListener('toggle', () => this.details.open && this.reveal(this.inputs.city));

    this.form = this.dataset.form ? document.getElementById(this.dataset.form) : this.closest('form');
    this.onSubmit = this.onSubmit.bind(this);
    this.form?.addEventListener('submit', this.onSubmit, true);
    if (this.city()) this.cityState();
  }

  disconnectedCallback() {
    this.form?.removeEventListener('submit', this.onSubmit, true);
  }

  /** Scrolls a field into view, clear of the drawer's sticky totals (its scroll-margin, snippets/address-check). */
  reveal(el) {
    if (this.closest('cart-drawer')) (el.matches('[data-list]') ? el : el.closest('[data-field]'))?.scrollIntoView({ block: 'nearest' });
  }

  // ---- data -----------------------------------------------------------------------------------

  async index() {
    try {
      return await loadLocalities(this.dataset.localities);
    } catch {
      this.say(this.status, 'error', this.t.load_error);
      return null;
    }
  }

  /** The listed locality of the typed city (null when not resolved), and its streets ([] when it has none). */
  async cityState() {
    const ix = await this.index();
    if (!ix) return null;
    const city = ix.byName.get(this.city()) || null;
    let streets = [];
    if (city?.shard != null) {
      try {
        const packed = (await loadShard(this.shardUrls[city.shard]))[city.name];
        streets = packed ? packed.split('|') : [];
      } catch {
        this.say(this.status, 'error', this.t.load_error);
        return null;
      }
    }
    // A kibbutz or a moshav has no streets on the list: the street is optional there.
    const label = this.querySelector('[data-field="street"] [data-label]');
    if (label) label.textContent = city && !streets.length ? this.t.street_none : this.t.street;
    return { ix, city, streets };
  }

  city() {
    return clean(this.inputs.city.value);
  }

  // ---- events ---------------------------------------------------------------------------------

  handleEvent(e) {
    const input = e.target.closest?.('[data-input]');
    const key = input?.dataset.input;
    if (e.type === 'input' && key) {
      memory[key] = input.value;
      if (key === 'city' || key === 'street') memory.keep[key] = false;
      this.clear(key);
      if (key === 'city') this.clear('street');
      if (key === 'city' || key === 'street') this.suggest(key);
    } else if (e.type === 'keydown' && key) {
      this.onKey(e, key);
    } else if (e.type === 'focusin' && key) {
      if (key === 'city' || key === 'street') this.index();
      this.reveal(input);
    } else if (e.type === 'focusout' && key) {
      // After a click on an option (mousedown keeps the focus, but a touch may not).
      setTimeout(() => {
        if (this.contains(document.activeElement) && document.activeElement === input) return;
        this.close(key);
        if (input.value.trim()) this.checkField(key);
      }, 150);
    } else if (e.type === 'mousedown' && e.target.closest('[role="option"]')) {
      e.preventDefault();
    } else if (e.type === 'click') {
      const option = e.target.closest('[role="option"]');
      const choice = e.target.closest('[data-choice]');
      const keep = e.target.closest('[data-keep]');
      if (option) this.pick(option.closest('[data-field]').dataset.field, option.dataset.value);
      else if (choice) this.pick(choice.dataset.field, choice.dataset.choice);
      else if (keep) {
        memory.keep[keep.dataset.keep] = true;
        this.clear(keep.dataset.keep);
      } else if (e.target.closest('[data-skip]')) this.skipCheck();
    }
  }

  onKey(e, key) {
    if (e.key === 'Enter') {
      // Inside the drawer's cart form Enter would submit it to checkout.
      e.preventDefault();
      const list = this.list(key);
      const opt = list && !list.hidden ? list.children[this.active[key]] : null;
      if (opt) this.pick(key, opt.dataset.value);
      else this.checkField(key);
      return;
    }
    const list = this.list(key);
    if (!list || list.hidden) {
      if (e.key === 'ArrowDown' && (key === 'city' || key === 'street')) this.suggest(key);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.children.length;
      this.active[key] = (this.active[key] + (e.key === 'ArrowDown' ? 1 : -1) + n + 1) % (n + 1);
      if (this.active[key] === n) this.active[key] = -1;
      this.mark(key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close(key);
    }
  }

  // ---- the lists under the fields ----------------------------------------------------------------

  list(key) {
    return this.querySelector(`[data-field="${key}"] [data-list]`);
  }

  async suggest(key) {
    const q = this.inputs[key].value;
    let names = [];
    if (/[א-תa-z]/i.test(q)) {
      if (key === 'city') {
        const ix = await this.index();
        names = ix ? searchCities(q, ix).map((c) => c.name) : [];
      } else {
        const state = await this.cityState();
        // "הרצל 12": the street's part; a number alone ("7") lists nothing.
        const part = splitStreetLine(q).street;
        names = part && state?.streets.length ? searchStreets(part, state.streets) : [];
      }
    }
    if (this.inputs[key].value !== q) return;
    const list = this.list(key);
    list.replaceChildren(
      ...names.map((name, i) => {
        const li = document.createElement('li');
        li.className = 'address-check__option';
        li.id = `${list.id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.value = name;
        li.textContent = name;
        return li;
      })
    );
    this.active[key] = -1;
    const open = names.length > 0 && !(names.length === 1 && names[0] === clean(q));
    list.hidden = !open;
    this.inputs[key].setAttribute('aria-expanded', String(open));
    if (open) this.reveal(list);
    this.mark(key);
  }

  mark(key) {
    const list = this.list(key);
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active[key])));
    const cur = list.children[this.active[key]];
    if (cur) {
      this.inputs[key].setAttribute('aria-activedescendant', cur.id);
      cur.scrollIntoView({ block: 'nearest' });
    } else this.inputs[key].removeAttribute('aria-activedescendant');
  }

  close(key) {
    const list = this.list(key);
    if (!list) return;
    list.hidden = true;
    this.inputs[key].setAttribute('aria-expanded', 'false');
    this.inputs[key].removeAttribute('aria-activedescendant');
  }

  pick(key, value) {
    this.inputs[key].value = value;
    memory[key] = value;
    memory.keep[key] = false;
    this.close(key);
    this.clear(key);
    if (key === 'city') {
      this.clear('street');
      this.cityState();
      (this.inputs.street.value ? this.inputs.number : this.inputs.street).focus();
    } else if (key === 'street') this.inputs.number.focus();
    else this.inputs[key].focus();
  }

  // ---- messages -------------------------------------------------------------------------------

  say(el, tone, text, { field, choices = [], keep = false } = {}) {
    if (!el) return;
    el.dataset.tone = tone || '';
    el.replaceChildren();
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      el.append(span);
    }
    for (const name of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'address-check__choice';
      b.dataset.field = field;
      b.dataset.choice = name;
      b.textContent = choices.length === 1 ? `${this.t.yes}, ${name}` : name;
      el.append(b);
    }
    if (keep) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'address-check__choice';
      b.dataset.keep = field;
      b.textContent = this.t.keep_typed;
      el.append(b);
    }
  }

  message(key, tone, text, opts) {
    const el = this.querySelector(`[data-field="${key}"] [data-message]`);
    this.say(el, tone, text, { field: key, ...opts });
    this.inputs[key].setAttribute('aria-invalid', String(tone === 'error'));
  }

  clear(key) {
    this.message(key, '', '');
    this.say(this.status, '', '');
  }

  // ---- checks ---------------------------------------------------------------------------------

  /** Checks one field as the shopper leaves it; returns true when it may go to checkout as it is now. */
  async checkField(key, state) {
    if (key === 'city') return this.checkCity(state);
    if (key === 'street' || key === 'number') {
      state ??= await this.cityState();
      return key === 'street' ? this.checkStreet(state) : this.checkNumber(state);
    }
    return true;
  }

  async checkCity() {
    const typed = this.city();
    if (!typed) return false;
    const ix = await this.index();
    if (!ix) return true;
    const r = matchCity(typed, ix);
    if (r.city && r.confident) {
      if (r.city.name !== typed) {
        this.inputs.city.value = memory.city = r.city.name;
        this.message('city', 'ok', fill(this.t.city_fixed, { name: r.city.name }));
      }
      this.cityState(); // its streets, and the street's label
      return true;
    }
    if (memory.keep.city) return true;
    if (r.city) this.message('city', 'error', fill(this.t.city_maybe, { name: r.city.name }), { choices: [r.city.name], keep: true });
    else if (r.candidates.length) this.message('city', 'error', this.t.city_unknown, { choices: r.candidates, keep: true });
    else this.message('city', 'error', this.t.city_unknown, { keep: true });
    return false;
  }

  checkStreet(state) {
    if (!state) return true;
    const input = this.inputs.street;
    let typed = clean(input.value);
    // "הגפן 50" in the street: the number goes to its field.
    const parts = splitStreetLine(typed);
    if (parts.number && (!parts.street || !clean(this.inputs.number.value))) {
      if (!clean(this.inputs.number.value)) this.inputs.number.value = memory.number = parts.number;
      typed = parts.street;
      input.value = memory.street = typed;
    }
    if (!typed) {
      if (!state.streets.length) return true;
      this.message('street', 'error', parts.number ? this.t.street_only_number : this.t.street_required);
      return false;
    }
    if (!state.city) {
      // A city kept as typed has no list to check the street against.
      if (memory.keep.city) return true;
      this.message('street', 'error', this.t.city_first);
      return false;
    }
    if (!state.streets.length || memory.keep.street) return true;
    const r = checkStreet(typed, state.streets);
    if (r.known) return true;
    if (r.suggestion && r.confident) {
      input.value = memory.street = r.suggestion;
      this.message('street', 'ok', fill(this.t.street_fixed, { name: r.suggestion }));
      return true;
    }
    const city = state.city.name;
    if (r.suggestion) this.message('street', 'error', fill(this.t.street_maybe, { name: r.suggestion }), { choices: [r.suggestion], keep: true });
    else this.message('street', 'error', fill(this.t.street_unknown, { city }), { choices: r.candidates, keep: true });
    return false;
  }

  checkNumber(state) {
    const n = clean(this.inputs.number.value);
    if (!n) {
      if (state && !state.streets.length && !clean(this.inputs.street.value)) return true;
      this.message('number', 'error', this.t.number_required);
      return false;
    }
    if (!HOUSE_NUMBER.test(n)) {
      this.message('number', 'error', this.t.number_invalid);
      return false;
    }
    return true;
  }

  /** Every field; the address for the cart when it passes, else null (the first wrong field has the focus). */
  async checkAll() {
    const okCity = await this.checkCity();
    const state = okCity ? await this.cityState() : null;
    if (okCity && state === null && !(await this.index())) return { address: null, unchecked: true };
    const okStreet = okCity ? this.checkStreet(state) : true;
    const okNumber = this.checkNumber(state);
    if (!okCity || !okStreet || !okNumber) {
      const first = ['city', 'street', 'number'].find((k) => this.inputs[k].getAttribute('aria-invalid') === 'true') || 'city';
      this.details.open = true;
      this.inputs[first].focus();
      this.say(this.status, 'error', this.t.fix_first);
      if (this.skip) this.skip.hidden = false;
      return { address: null };
    }
    const city = this.city();
    const street = clean(this.inputs.street.value);
    const number = clean(this.inputs.number.value);
    const extra = clean(this.inputs.extra.value);
    const address1 = clean(`${street || city} ${number}`);
    this.say(this.status, 'ok', this.t.ok);
    return { address: { address1, address2: extra || null, city } };
  }

  // ---- the checkout press -----------------------------------------------------------------------

  filled() {
    return ['city', 'street', 'number'].some((k) => clean(this.inputs[k].value));
  }

  onSubmit(e) {
    const submitter = e.submitter;
    if (this.passing || submitter?.name !== 'checkout') return;
    if (!this.filled() && this.mode !== 'required') return;
    e.preventDefault();
    if (this.busy) return;
    this.lastSubmitter = submitter;
    this.close('city');
    this.close('street');
    if (!this.filled()) {
      this.details.open = true;
      this.say(this.status, 'error', this.t.required);
      this.inputs.city.focus();
      return;
    }
    this.busy = true;
    submitter.setAttribute('aria-busy', 'true');
    this.checkAll()
      .then(async ({ address, unchecked }) => {
        if (!address && !unchecked) return false;
        if (address) await setCartAddress(address);
        return true;
      })
      .catch(() => true)
      .then((go) => {
        this.busy = false;
        submitter.removeAttribute('aria-busy');
        if (go) this.go(submitter);
      });
  }

  go(submitter) {
    this.passing = true;
    try {
      if (this.form.requestSubmit) this.form.requestSubmit(submitter);
      else submitter.click();
    } finally {
      this.passing = false;
    }
  }

  skipCheck() {
    for (const k of FIELDS) {
      this.inputs[k].value = memory[k] = '';
      this.clear(k);
    }
    memory.keep = { city: false, street: false };
    this.skip.hidden = true;
    if (this.lastSubmitter && this.mode !== 'required') this.go(this.lastSubmitter);
  }
}

customElements.get('address-check') || customElements.define('address-check', AddressCheck);
