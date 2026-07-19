// プロジェクトパネル (フッテージ/コンポ一覧)
import { el, durationToTimecode } from './utils.js';
import { state, bus, getItem, getCompById } from './state.js';
import * as actions from './actions.js';
import * as dialogs from './dialogs.js';

const TYPE_ICONS = {
  composition: '<svg viewBox="0 0 14 14"><rect x="1" y="2" width="12" height="10" fill="none" stroke="#9ab" stroke-width="1"/><line x1="4.3" y1="2" x2="4.3" y2="12" stroke="#9ab"/><line x1="9.7" y1="2" x2="9.7" y2="12" stroke="#9ab"/><line x1="1" y1="5" x2="4.3" y2="5" stroke="#9ab"/><line x1="1" y1="9" x2="4.3" y2="9" stroke="#9ab"/><line x1="9.7" y1="5" x2="13" y2="5" stroke="#9ab"/><line x1="9.7" y1="9" x2="13" y2="9" stroke="#9ab"/></svg>',
  image: '<svg viewBox="0 0 14 14"><rect x="1.5" y="2" width="11" height="10" fill="none" stroke="#b8a06a" stroke-width="1"/><circle cx="5" cy="5.5" r="1.2" fill="#b8a06a"/><path d="M2 11 L6 7 L8.5 9.5 L10 8 L12.5 10.5" stroke="#b8a06a" fill="none"/></svg>',
  video: '<svg viewBox="0 0 14 14"><rect x="1" y="3" width="9" height="8" fill="none" stroke="#8fb" stroke-width="1"/><path d="M10 6 L14 4 V10 L10 8 Z" fill="none" stroke="#8fb"/></svg>',
  solid: null, // カラーチップで表示
};

export function initProjectPanel(container) {
  const search = el('input', { class: 'panel-search', placeholder: '検索', type: 'text' });
  const list = el('div', { class: 'project-list' });
  const footer = el('div', { class: 'project-footer' },
    el('button', { class: 'pf-btn', title: '新規コンポジション', html: '<svg viewBox="0 0 16 16"><rect x="1" y="2.5" width="14" height="11" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="5.2" y1="2.5" x2="5.2" y2="13.5" stroke="currentColor"/><line x1="10.8" y1="2.5" x2="10.8" y2="13.5" stroke="currentColor"/></svg>', on: { click: () => dialogs.newCompDialog() } }),
    el('button', { class: 'pf-btn', title: 'フッテージを読み込み', html: '<svg viewBox="0 0 16 16"><path d="M2 5 a1.5 1.5 0 0 1 1.5 -1.5 H6 L7.5 5 H13 a1 1 0 0 1 1 1 V12 a1 1 0 0 1 -1 1 H3.5 A1.5 1.5 0 0 1 2 11.5 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>', on: { click: () => dialogs.pickFiles('image/*,video/*', true, f => actions.importFootageFiles(f)) } }),
    el('button', { class: 'pf-btn', title: '削除', html: '<svg viewBox="0 0 16 16"><path d="M3 4 H13 M6 4 V2.5 H10 V4 M4.5 4 L5.2 13.5 H10.8 L11.5 4 M6.8 6.5 V11 M9.2 6.5 V11" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>', on: { click: () => { if (state.selectedItemId) actions.deleteProjectItem(state.selectedItemId); } } }),
  );
  search.addEventListener('input', render);
  container.append(el('div', { class: 'project-panel' },
    el('div', { class: 'project-head' }, search),
    el('div', { class: 'project-cols' },
      el('span', { class: 'pc-name', text: '名前' }),
      el('span', { class: 'pc-type', text: '種類' }),
      el('span', { class: 'pc-size', text: 'サイズ' }),
      el('span', { class: 'pc-dur', text: 'デュレーション' })),
    list, footer));

  function itemLabel(item) {
    if (item.mainType === 'composition') return 'コンポジション';
    if (item.mainType === 'solid') return 'ソリッド';
    return item.kind === 'video' ? 'ムービー' : '静止画';
  }
  function itemSize(item) {
    if (item.mainType === 'composition') {
      const c = getCompById(item.id);
      return c ? `${c.width}×${c.height}` : '';
    }
    return item.width ? `${item.width}×${item.height}` : '—';
  }
  function itemDur(item) {
    if (item.mainType === 'composition') {
      const c = getCompById(item.id);
      return c ? durationToTimecode(c.duration, c.fps) : '';
    }
    if (item.kind === 'video' && item.duration) return item.duration.toFixed(2) + '秒';
    return '';
  }
  function iconFor(item) {
    if (item.mainType === 'solid') {
      return el('span', { class: 'item-icon solid-chip', style: { background: item.color } });
    }
    const key = item.mainType === 'composition' ? 'composition' : item.kind;
    return el('span', { class: 'item-icon', html: TYPE_ICONS[key] || '' });
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    if (!state.project) return;
    for (const item of state.project.items) {
      if (q && !item.name.toLowerCase().includes(q)) continue;
      const row = el('div', {
        class: 'project-item' + (state.selectedItemId === item.id ? ' selected' : '') +
          (item.mainType === 'composition' && state.currentCompId === item.id ? ' current' : ''),
        dataset: { id: item.id },
      },
        iconFor(item),
        el('span', { class: 'pc-name', text: item.name, title: item.name }),
        el('span', { class: 'pc-type', text: itemLabel(item) }),
        el('span', { class: 'pc-size', text: itemSize(item) }),
        el('span', { class: 'pc-dur', text: itemDur(item) }),
      );
      row.addEventListener('click', () => {
        state.selectedItemId = item.id;
        bus.emit('project');
      });
      row.addEventListener('dblclick', () => {
        if (item.mainType === 'composition') actions.openComposition(item.id);
        else if (item.mainType === 'footage') actions.addFootageLayer(item.id);
        else if (item.mainType === 'solid') {
          const layer = (Object.values(state.project.comps).flatMap(c => c.layers)).find(l => l.sourceId === item.id);
          if (layer) dialogs.solidSettingsDialog(layer);
        }
      });
      list.append(row);
    }
    if (!state.project.items.length) {
      list.append(el('div', { class: 'project-empty', text: 'フッテージを読み込むには、ファイル > 読み込み を使用してください' }));
    }
  }
  bus.on('project', render);
  bus.on('layers', render); // デュレーション等の更新反映
  render();
}
