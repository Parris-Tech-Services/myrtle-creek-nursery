import { esc, dollars, toCents } from './util.js';

export function toast(msg, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
  t.textContent = msg; t.className = 'show';
  clearTimeout(t._t); t._t = setTimeout(() => t.className = '', ms);
}

export function overlay(inner) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="sheet">${inner}</div>`;
  document.body.append(o);
  return o;
}

/** Pick one of several big buttons. options: [[value,label]]. Resolves value or null. */
export function choose(title, options, note = '') {
  return new Promise(res => {
    const o = overlay(`<h3>${esc(title)}</h3>${note ? `<p>${esc(note)}</p>` : ''}
      ${options.map(([v, l], i) => `<button class="btn big" data-i="${i}">${esc(l)}</button>`).join('')}
      <button class="btn ghost" data-i="-1">Cancel</button>`);
    o.onclick = e => {
      const b = e.target.closest('button'); if (!b && e.target !== o) return;
      const i = b ? +b.dataset.i : -1; o.remove(); res(i >= 0 ? options[i][0] : null);
    };
  });
}

/**
 * Small form dialog. fields: [{name,label,type,options,hint}] type: text|number|money|date|select|textarea|checkbox.
 * money values come back in cents. Resolves values object, or null if cancelled.
 */
export function askForm(title, fields, values = {}, { submit = 'Save', extra = [] } = {}) {
  return new Promise(res => {
    const inp = f => {
      const v = values[f.name];
      if (f.type === 'select') return `<select name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${k == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea name="${f.name}" rows="3">${esc(v)}</textarea>`;
      if (f.type === 'checkbox') return `<input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}>`;
      if (f.type === 'money') return `<input name="${f.name}" inputmode="decimal" value="${v == null ? '' : dollars(v)}" placeholder="0.00">`;
      if (f.type === 'number') return `<input name="${f.name}" type="number" inputmode="numeric" step="any" value="${v ?? ''}">`;
      return `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}">`;
    };
    const o = overlay(`<form><h3>${esc(title)}</h3>
      ${fields.map(f => `<label class="${f.type === 'checkbox' ? 'chk' : ''}" ${f.showWhen ? `data-when="${f.showWhen[0]}" data-in="${f.showWhen[1].join(',')}"` : ''}><span>${esc(f.label)}</span>${inp(f)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`).join('')}
      <div class="row"><button type="button" class="btn ghost" data-x="cancel">Cancel</button>
      ${extra.map(([k, l]) => `<button type="button" class="btn danger" data-x="${k}">${esc(l)}</button>`).join('')}
      <button class="btn primary">${esc(submit)}</button></div></form>`);
    const form = o.querySelector('form');
    const when = () => form.querySelectorAll('label[data-when]').forEach(l => { l.hidden = !l.dataset.in.split(',').includes(form.elements[l.dataset.when].value); });
    form.onchange = when; when();
    form.onsubmit = e => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'money' ? toCents(el.value) : f.type === 'number' ? (el.value === '' ? null : +el.value) : el.value.trim();
      }
      o.remove(); res(out);
    };
    form.onclick = e => {
      const x = e.target.dataset.x; if (!x) return;
      o.remove(); res(x === 'cancel' ? null : { _action: x });
    };
    const first = form.querySelector('input:not([type=checkbox]),select,textarea'); if (first && !values[fields[0].name]) first.focus();
  });
}

/** Own confirm dialog (native confirm() is blocked or silent in some webviews). */
export function confirmBox(message, ok = 'Yes', danger = false) {
  return new Promise(res => {
    const o = overlay(`<h3>Please confirm</h3><p style="white-space:pre-line">${esc(message)}</p>
      <div class="row"><button class="btn ghost" data-v="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button></div>`);
    o.onclick = e => { const b = e.target.closest('button'); if (!b) return; o.remove(); res(b.dataset.v === '1'); };
  });
}

export function banner(root, html) { root.insertAdjacentHTML('afterbegin', `<div class="banner">${html}</div>`); }

/** Toast with an Undo button, available for 10 seconds. */
export function undoToast(msg, undo, label = 'Undo') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
  t.innerHTML = `<span>${esc(msg)}</span> <button type="button">${esc(label)}</button>`;
  t.className = 'show undo';
  const hide = () => { t.className = ''; };
  t.querySelector('button').onclick = async () => { hide(); try { await undo(); toast('Undone'); } catch (e) { toast('Could not undo: ' + e.message, 4000); } };
  clearTimeout(t._t); t._t = setTimeout(hide, 10000);
}

/** +/- stepper around a numeric input. attrs e.g. 'data-ret="id"'. Pair with stepperClick(). */
export const stepperHtml = (attrs, value, label = 'Quantity') => `<span class="stepper"><button type="button" data-step="-1" aria-label="One less. ${esc(label)}">&minus;</button>
  <input class="num" type="number" inputmode="numeric" min="0" ${attrs} value="${value ?? ''}" aria-label="${esc(label)}"><button type="button" data-step="1" aria-label="One more. ${esc(label)}">+</button></span>`;
/** Handles a tap on a stepper button: changes the input and fires its change event (so the page saves it). */
export function stepperClick(e) {
  const b = e.target.closest('button[data-step]'); if (!b) return false;
  const input = b.parentElement.querySelector('input');
  input.value = Math.max(0, (parseInt(input.value, 10) || 0) + +b.dataset.step);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
