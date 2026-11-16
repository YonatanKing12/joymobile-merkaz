// Leads to the Joy Mobile dashboard: the contact forms of sections/contact-form.liquid (the contact page, JOY FIX,
// trade-in) still post to Shopify exactly as before (Shopify's email to the store and its success message) and,
// beside it, create a lead in the dashboard: the endpoint the iPhone Duo page posts to (sections/iphone-duo-landing
// .liquid, LEADS_ENDPOINT: POST /api/public/leads, JSON in a text/plain body, no credentials). The dashboard files the
// lead under the store whose domain sent it (the request's Origin), so the page sends no store id.
// - Which forms: those carrying <script type="application/json" data-dashboard-lead> (the section writes it when
//   "שליחה ללידים בדשבורד" is on, never in the theme editor): the lead's source, the consent text version, the privacy
//   page the consent box links to, the form type and its fixed subject.
// - Never in the way of the form: the listener captures on window (ahead of Shopify's spam protection, which cancels
//   the submit event and later sends the form with an event-less form.submit(), as assets/crm-hooks.js notes), sends
//   with keepalive (the page navigates away right after) without waiting for an answer, and swallows every error.
//   The browser's own validation (required fields, the privacy box) stops an invalid form before any submit event.
// - The dashboard's rules (src/lib/leads.ts parsePublicLead): an Israeli mobile is the lead's key, so a form without
//   one is not sent; `website` is the honeypot; an unchanged resend reuses its requestId (the dashboard keeps it once).
//   marketingConsent is true only when the visitor ticked the optional "אשמח לקבל עדכונים" box: the privacy box is
//   not consent to advertising.
const LEADS_ENDPOINT = 'https://joy-mobile-online.onrender.com/api/public/leads';
// The dashboard refuses a body over 8 KB (LEAD_BODY_MAX_BYTES).
const BODY_LIMIT = 7900;
const MESSAGE_MAX = 2000;
const DETAIL_MAX = 200;
const RESEND_WINDOW_MS = 5000;

// The dashboard's normalizeLeadPhone (and the iPhone Duo page's normalizePhone): an Israeli mobile → 05XXXXXXXX, else ''.
function normalizePhone(value) {
  const raw = String(value).trim();
  if (!/^[+\d\s()-]+$/.test(raw)) return '';
  let digits = raw.replace(/[\s()-]/g, '');
  if (digits.startsWith('+972')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('00972')) digits = '0' + digits.slice(5);
  else if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return /^05\d{8}$/.test(digits) ? digits : '';
}

function leadConfig(form) {
  try {
    const config = JSON.parse(form.querySelector('script[data-dashboard-lead]')?.textContent || 'null');
    return config && typeof config.source === 'string' && config.source ? config : null;
  } catch {
    return null;
  }
}

// The section's fields are id'd "<form id>-name", "-phone", "-email", "-body", "-marketing", "-privacy".
const OWN_FIELDS = ['name', 'phone', 'email', 'body', 'marketing', 'privacy'];
const field = (form, key) => document.getElementById(`${form.id}-${key}`);
const valueOf = (el) => (el && typeof el.value === 'string' ? el.value.trim() : '');

function buildLead(form, config) {
  const phone = normalizePhone(valueOf(field(form, 'phone')));
  if (!phone) return null;
  // The form type's own fields (device, fault, branch, condition, storage), by their Hebrew labels.
  const own = new Set(OWN_FIELDS.map((key) => `${form.id}-${key}`));
  const details = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || own.has(el.id)) continue;
    const match = /^contact\[(.+)\]$/.exec(el.name);
    if (!match || match[1] === 'subject') continue;
    if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
    const value = valueOf(el);
    if (value) details[match[1].slice(0, 100)] = value.slice(0, DETAIL_MAX);
  }
  const privacy = field(form, 'privacy');
  return {
    source: config.source,
    name: valueOf(field(form, 'name')),
    phone,
    email: valueOf(field(form, 'email')),
    // The campaign fields the dashboard's form requires: a contact form has no colour, and no contact-method choice.
    color: 'undecided',
    tradeIn: config.kind === 'trade_in' ? 'interested' : 'undecided',
    contactMethod: 'phone',
    marketingConsent: field(form, 'marketing')?.checked === true,
    consentDefault: 'unchecked',
    consentVersion: config.consentVersion,
    privacyPolicyUrl: privacy?.checked && config.privacyUrl ? new URL(config.privacyUrl, location.origin).href : '',
    formKind: config.kind,
    subject: config.subject || '',
    message: valueOf(field(form, 'body')).slice(0, MESSAGE_MAX),
    details,
    pageUrl: location.origin + location.pathname,
    website: form.querySelector('input[data-dashboard-lead-hp]')?.value || '',
  };
}

const byteLength = (text) => new TextEncoder().encode(text).length;

function send(body) {
  try {
    if ('keepalive' in Request.prototype) {
      fetch(LEADS_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
      }).catch(() => {});
    } else {
      navigator.sendBeacon?.(LEADS_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    }
  } catch {
    /* never block the form */
  }
}

// The last lead each form sent: an unchanged resend keeps its requestId, and goes out once within a few seconds.
const previous = new WeakMap();

function onSubmit(event) {
  try {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const config = leadConfig(form);
    if (!config || typeof crypto?.randomUUID !== 'function') return;
    const lead = buildLead(form, config);
    if (!lead) return;
    const key = JSON.stringify(lead);
    const last = previous.get(form);
    if (last && last.key === key && Date.now() - last.at < RESEND_WINDOW_MS) return;
    const request = last && last.key === key ? last.request : { requestId: crypto.randomUUID(), consentRecordedAt: new Date().toISOString() };
    previous.set(form, { key, request, at: Date.now() });
    const payload = { ...lead, ...request };
    let body = JSON.stringify(payload);
    if (byteLength(body) > BODY_LIMIT) body = JSON.stringify({ ...payload, message: payload.message.slice(0, 500), details: {} });
    if (byteLength(body) > BODY_LIMIT) return;
    send(body);
  } catch {
    /* never block the form */
  }
}

// The honeypot (the dashboard's `website`): off-screen, out of the tab order, ignored by Shopify (not a contact[] field).
for (const config of document.querySelectorAll('script[data-dashboard-lead]')) {
  const form = config.closest('form');
  if (!form || form.querySelector('input[data-dashboard-lead-hp]')) continue;
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.dataset.dashboardLeadHp = '';
  honeypot.setAttribute('aria-hidden', 'true');
  honeypot.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
  form.append(honeypot);
}

window.addEventListener('submit', onSubmit, true);
