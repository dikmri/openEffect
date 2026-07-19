// エフェクトコントロール パネル + エフェクト＆プリセット パネル
import { el } from './utils.js';
import { state, bus, selectedLayers, getLayer, snapshot } from './state.js';
import * as actions from './actions.js';
import { EFFECTS, EFFECT_CATEGORIES, getEffectDef } from './effects.js';

// ---- エフェクトコントロール ----
export function initEffectControls(container) {
  const root = el('div', { class: 'ec-panel' });
  container.append(root);

  function paramControl(layer, fx, spec) {
    const val = fx.params[spec.key];
    if (spec.type === 'color') {
      const input = el('input', { type: 'color', value: val });
      input.addEventListener('click', () => snapshot());
      input.addEventListener('input', () => actions.setEffectParam(layer.id, fx.id, spec.key, input.value));
      return input;
    }
    if (spec.type === 'checkbox') {
      const input = el('input', { type: 'checkbox', checked: !!val });
      input.addEventListener('change', () => { snapshot(); actions.setEffectParam(layer.id, fx.id, spec.key, input.checked); });
      return input;
    }
    if (spec.type === 'select') {
      const sel = el('select', {}, (spec.options || []).map(([v, l]) => el('option', { value: v, text: l, selected: v === val })));
      sel.addEventListener('change', () => { snapshot(); actions.setEffectParam(layer.id, fx.id, spec.key, sel.value); });
      return sel;
    }
    // slider / number
    const num = el('input', { type: 'number', class: 'ec-num', value: round2(val), step: spec.step || 1 });
    const applyNum = () => {
      let v = parseFloat(num.value);
      if (isNaN(v)) return;
      if (spec.min != null) v = Math.max(spec.min, v);
      if (spec.max != null) v = Math.min(spec.max, v);
      snapshot();
      actions.setEffectParam(layer.id, fx.id, spec.key, v);
    };
    num.addEventListener('change', applyNum);
    if (spec.type === 'number') return num;
    const range = el('input', { type: 'range', class: 'ec-slider', min: spec.min ?? 0, max: spec.max ?? 100, step: spec.step || 1, value: val });
    range.addEventListener('pointerdown', () => snapshot());
    range.addEventListener('input', () => { num.value = range.value; actions.setEffectParam(layer.id, fx.id, spec.key, parseFloat(range.value)); });
    return el('div', { class: 'ec-slider-wrap' }, range, num, spec.unit ? el('span', { class: 'ec-unit', text: spec.unit }) : null);
  }

  function render() {
    root.textContent = '';
    const layer = selectedLayers()[0];
    if (!layer) {
      root.append(el('div', { class: 'panel-empty', text: 'レイヤーが選択されていません' }));
      return;
    }
    root.append(el('div', { class: 'ec-layername', text: layer.name }));
    if (!layer.effects.length) {
      root.append(el('div', { class: 'panel-empty', text: 'エフェクトは適用されていません。「エフェクト＆プリセット」パネルからダブルクリックで適用できます。' }));
      return;
    }
    layer.effects.forEach((fx, idx) => {
      const def = getEffectDef(fx.effectId);
      if (!def) return;
      const fxToggle = el('span', { class: 'ec-fx-toggle' + (fx.enabled ? ' on' : ''), text: 'fx', title: 'エフェクトの有効/無効' });
      fxToggle.addEventListener('click', () => actions.toggleEffect(layer.id, fx.id));
      const head = el('div', { class: 'ec-fx-head' },
        fxToggle,
        el('span', { class: 'ec-fx-name', text: def.name }),
        el('span', { class: 'ec-fx-btns' },
          el('button', { class: 'ec-btn', text: 'リセット', title: 'パラメータを初期値に戻す', on: { click: () => actions.resetEffect(layer.id, fx.id) } }),
          el('button', { class: 'ec-btn', text: '▲', title: '上へ', on: { click: () => actions.moveEffect(layer.id, fx.id, -1) } }),
          el('button', { class: 'ec-btn', text: '▼', title: '下へ', on: { click: () => actions.moveEffect(layer.id, fx.id, 1) } }),
          el('button', { class: 'ec-btn', text: '削除', title: 'エフェクトを削除', on: { click: () => actions.removeEffect(layer.id, fx.id) } }),
        ));
      const params = el('div', { class: 'ec-params' + (fx.enabled ? '' : ' disabled') },
        def.params.map(spec => el('div', { class: 'ec-param-row' },
          el('label', { class: 'ec-param-label', text: spec.label }),
          paramControl(layer, fx, spec))));
      root.append(el('div', { class: 'ec-fx' }, head, params));
    });
  }
  bus.on('selection', render);
  bus.on('layers', render);
  render();
}

function round2(v) { return Math.round((+v || 0) * 100) / 100; }

// ---- エフェクト＆プリセット ----
export function initEffectsPresets(container) {
  const search = el('input', { class: 'panel-search', placeholder: '検索', type: 'text' });
  const list = el('div', { class: 'ep-list' });
  container.append(el('div', { class: 'ep-panel' }, el('div', { class: 'project-head' }, search), list));
  search.addEventListener('input', render);

  const openCats = new Set(EFFECT_CATEGORIES);

  function render() {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    for (const cat of EFFECT_CATEGORIES) {
      const effects = EFFECTS.filter(e => e.cat === cat && (!q || e.name.toLowerCase().includes(q)));
      if (!effects.length) continue;
      const open = q ? true : openCats.has(cat);
      const twirl = el('span', { class: 'ep-twirl' + (open ? ' open' : ''), text: '▸' });
      const head = el('div', { class: 'ep-cat' }, twirl, el('span', { text: cat }));
      const items = el('div', { class: 'ep-items', style: { display: open ? 'block' : 'none' } });
      head.addEventListener('click', () => {
        if (openCats.has(cat)) openCats.delete(cat); else openCats.add(cat);
        render();
      });
      for (const e of effects) {
        const item = el('div', { class: 'ep-item', text: e.name, title: 'ダブルクリックで選択レイヤーに適用' });
        item.addEventListener('dblclick', () => {
          if (!actions.applyEffectToSelected(e.id)) {
            // 選択なし: 何もしない (AE と同様にパネル側で無視)
          }
        });
        items.append(item);
      }
      list.append(head, items);
    }
  }
  render();
}
