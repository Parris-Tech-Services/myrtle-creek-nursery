import { settleCash, breakdown, describeBreakdown, quickAmounts, NOTE_BUTTONS } from './cash.js';
import { overlay } from './ui.js';
import { money, toCents, dollars, $ } from './util.js';

/**
 * Cash dialog: quick amounts, keypad, big change due, change breakdown. Optional: "Done" with nothing entered = exact cash.
 * Resolves {tendered, change, rounding, cashAmount, rest} or null. `rest` = {method, amount} when the customer is short
 * and the remainder goes on card or transfer; then cashAmount is what they actually handed over.
 */
export function changeDialog(cashPortion) {
  const exact = settleCash(cashPortion, null);
  return new Promise(res => {
    const btn = (a, label, extra = '') => `<button type="button" class="btn ${extra}" data-v="${a}" ${label === 'Exact' ? 'data-exact="1"' : ''}>${label}</button>`;
    const o = overlay(`<div class="chg"><h3>Cash payment</h3>
      <div class="kv"><span>Cash due${exact.rounding ? `<small>rounded to the nearest 5c from ${money(cashPortion)}</small>` : ''}</span><b class="amt">${money(exact.due)}</b></div>
      <div class="kv"><span>Cash given</span><b class="amt" id="given">-</b></div>
      <div class="quick">${btn(exact.due, 'Exact', 'primary')}${quickAmounts(exact.due).map(a => btn(a, money(a).replace('.00', ''))).join('')}</div>
      <div class="quick">${NOTE_BUTTONS.map(a => btn(a, money(a).replace('.00', ''))).join('')}</div>
      <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button type="button" class="key" data-k="${k}" aria-label="${k === '⌫' ? 'Backspace' : k}">${k}</button>`).join('')}</div>
      <div class="chg-out"><div class="chg-label" id="lbl">Change due</div><div class="change-due" id="change">-</div><div id="bd" class="muted"></div></div>
      <div id="rest" class="row"></div>
      <div class="row"><button type="button" class="btn ghost" data-x="1">Cancel</button><button type="button" class="btn primary big" id="done">Done</button></div></div>`);
    let buf = '';
    const given = () => (buf === '' ? null : toCents(buf));
    const upd = () => {
      const g = given(), s = settleCash(cashPortion, g);
      $('#given', o).textContent = g == null ? '-' : money(g);
      const done = $('#done', o), rest = $('#rest', o);
      rest.innerHTML = '';
      if (g == null) { $('#lbl', o).textContent = 'Change due'; $('#change', o).textContent = '-'; $('#bd', o).textContent = 'Tap Done for exact cash.'; done.disabled = false; return; }
      if (s.short > 0) {
        $('#lbl', o).textContent = 'Short'; $('#change', o).textContent = money(s.short); $('#bd', o).textContent = 'Give more cash, or put the rest on:'; done.disabled = true;
        if (g > 0) rest.innerHTML = `<button type="button" class="btn" data-rest="card">Rest on card</button><button type="button" class="btn" data-rest="transfer">Rest on Transfer / PayID</button>`;
        return;
      }
      $('#lbl', o).textContent = 'Change due'; $('#change', o).textContent = money(s.change);
      $('#bd', o).textContent = s.change ? describeBreakdown(breakdown(s.change)) : 'No change';
      done.disabled = false;
    };
    o.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset;
      if (d.exact) { o.remove(); return res({ tendered: exact.due, change: 0, rounding: exact.rounding, cashAmount: cashPortion, rest: null }); }   // one tap: exact cash
      if (d.v) buf = dollars(+d.v);
      else if (d.k) buf = d.k === '⌫' ? buf.slice(0, -1) : d.k === '.' ? (buf.includes('.') ? buf : (buf || '0') + '.') : (/\.\d\d$/.test(buf) ? buf : buf + d.k);
      else if (d.x) { o.remove(); return res(null); }
      else if (d.rest) {
        const g = given(); o.remove();
        return res({ tendered: g, change: 0, rounding: 0, cashAmount: g, rest: { method: d.rest, amount: cashPortion - g } });
      } else if (b.id === 'done') {
        const s = settleCash(cashPortion, given()); o.remove();
        return res({ tendered: s.tendered, change: s.change, rounding: s.rounding, cashAmount: cashPortion, rest: null });
      }
      upd();
    };
    upd();
  });
}
