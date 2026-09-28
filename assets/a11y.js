// Applies saved classes on import: load it async in <head> to avoid a flash.
import { DialogElement, announce, t, define } from '@theme/global';

const KEY = 'mhm:a11y';
const CLASSES = ['a11y-text-lg', 'a11y-text-xl', 'a11y-contrast', 'a11y-links', 'a11y-readable', 'a11y-no-motion'];
const html = document.documentElement;

let active = [];
try {
  active = (JSON.parse(localStorage.getItem(KEY)) || []).filter((c) => CLASSES.includes(c));
} catch {}
html.classList.add(...active);

function apply(next) {
  active = next;
  CLASSES.forEach((c) => html.classList.toggle(c, active.includes(c)));
  try {
    localStorage.setItem(KEY, JSON.stringify(active));
  } catch {}
  document.querySelectorAll('a11y-panel').forEach((panel) => panel.sync());
}

class A11yPanel extends DialogElement {
  connectedCallback() {
    super.connectedCallback();
    // Loaded async in <head>: the parser may upgrade the panel before its buttons exist.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.sync(), { once: true });
    else this.sync();
  }

  handleEvent(e) {
    const btn = e.type === 'click' && e.target.closest('[data-a11y], [data-a11y-reset]');
    if (!btn) return super.handleEvent(e);
    if (btn.hasAttribute('data-a11y-reset')) {
      apply([]);
      return announce(t('a11yReset'));
    }
    const name = btn.dataset.a11y, size = name.startsWith('a11y-text-');
    const rest = active.filter((c) => c !== name && !(size && c.startsWith('a11y-text-')));
    apply(active.includes(name) ? rest : [...rest, name]);
  }

  sync() {
    this.querySelectorAll('[data-a11y]').forEach((el) => el.setAttribute('aria-pressed', active.includes(el.dataset.a11y)));
  }
}

define('a11y-panel', A11yPanel);
