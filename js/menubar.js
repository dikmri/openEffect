// メニューバー (AE 風ドロップダウン)
import { el } from './utils.js';
import { runCommand, isEnabled } from './commands.js';
import { EFFECTS, EFFECT_CATEGORIES } from './effects.js';
import { state } from './state.js';

const SEP = '-';

function effectSubmenu() {
  return EFFECT_CATEGORIES.map(cat => ({
    label: cat,
    submenu: EFFECTS.filter(e => e.cat === cat).map(e => ({ label: e.name, cmd: 'effect.' + e.id })),
  }));
}

const MENUS = [
  { label: 'ファイル', items: [
    { label: '新規', submenu: [{ label: '新規プロジェクト', cmd: 'file.newProject', shortcut: 'Ctrl+Alt+N' }] },
    { label: 'プロジェクトを開く…', cmd: 'file.open', shortcut: 'Ctrl+O' },
    { label: 'プロジェクトを保存', cmd: 'file.save', shortcut: 'Ctrl+S' },
    SEP,
    { label: '読み込み', submenu: [{ label: 'ファイル…', cmd: 'file.import', shortcut: 'Ctrl+I' }] },
    { label: '書き出し', submenu: [{ label: 'WebM で書き出し…', cmd: 'file.exportWebM' }] },
  ]},
  { label: '編集', items: [
    { label: '取り消し', cmd: 'edit.undo', shortcut: 'Ctrl+Z' },
    { label: 'やり直し', cmd: 'edit.redo', shortcut: 'Ctrl+Y' },
    SEP,
    { label: 'すべて選択', cmd: 'edit.selectAll', shortcut: 'Ctrl+A' },
    { label: '選択解除', cmd: 'edit.deselect', shortcut: 'Ctrl+Shift+A' },
    SEP,
    { label: '複製', cmd: 'edit.duplicate', shortcut: 'Ctrl+D' },
    { label: 'レイヤーを分割', cmd: 'edit.split', shortcut: 'Ctrl+Shift+D' },
    { label: '削除', cmd: 'edit.delete', shortcut: 'Del' },
  ]},
  { label: 'コンポジション', items: [
    { label: '新規コンポジション…', cmd: 'comp.new', shortcut: 'Ctrl+N' },
    { label: 'コンポジション設定…', cmd: 'comp.settings', shortcut: 'Ctrl+K' },
  ]},
  { label: 'レイヤー', items: [
    { label: '新規', submenu: [
      { label: 'テキスト', cmd: 'layer.newText' },
      { label: 'ソリッド…', cmd: 'layer.newSolid', shortcut: 'Ctrl+Y' },
    ]},
    { label: 'レイヤー設定…', cmd: 'layer.settings', shortcut: 'Ctrl+Shift+Y' },
    SEP,
    { label: '重ね順', submenu: [
      { label: '最前面へ', cmd: 'layer.orderTop', shortcut: 'Ctrl+Shift+]' },
      { label: '1つ前面へ', cmd: 'layer.orderUp', shortcut: 'Ctrl+]' },
      { label: '1つ背面へ', cmd: 'layer.orderDown', shortcut: 'Ctrl+[' },
      { label: '最背面へ', cmd: 'layer.orderBottom', shortcut: 'Ctrl+Shift+[' },
    ]},
    SEP,
    { label: 'トランスフォームをリセット', cmd: 'layer.resetTransform' },
    { label: '時間', submenu: [
      { label: '現在時間にインポイントを設定', cmd: 'layer.trimIn', shortcut: 'Alt+[' },
      { label: '現在時間にアウトポイントを設定', cmd: 'layer.trimOut', shortcut: 'Alt+]' },
    ]},
    SEP,
    { label: '複製', cmd: 'layer.duplicate', shortcut: 'Ctrl+D' },
    { label: 'レイヤーを分割', cmd: 'layer.split', shortcut: 'Ctrl+Shift+D' },
    { label: '削除', cmd: 'layer.delete', shortcut: 'Del' },
  ]},
  { label: 'エフェクト', items: effectSubmenu() },
  { label: 'アニメーション', items: [
    { label: 'キーフレーム補助', submenu: [
      { label: 'イージーイーズ', cmd: 'anim.ease', shortcut: 'F9' },
      { label: 'リニア', cmd: 'anim.linear' },
    ]},
    { label: '選択したキーフレームを削除', cmd: 'anim.deleteKf' },
  ]},
  { label: '表示', items: [
    { label: 'ズームイン', cmd: 'view.zoomIn', shortcut: '.' },
    { label: 'ズームアウト', cmd: 'view.zoomOut', shortcut: ',' },
    { label: 'フィット', cmd: 'view.fit', shortcut: 'Shift+/' },
    { label: '100%', cmd: 'view.100', shortcut: 'Alt+/' },
  ]},
  { label: 'ウィンドウ', items: [
    { label: 'プロジェクト', cmd: 'window.project', panel: 'project' },
    { label: 'エフェクトコントロール', cmd: 'window.effectControls', panel: 'effectControls' },
    { label: '情報', cmd: 'window.info', panel: 'info' },
    { label: 'プレビュー', cmd: 'window.preview', panel: 'preview' },
    { label: 'エフェクト＆プリセット', cmd: 'window.effects', panel: 'effects' },
    { label: 'タイムライン', cmd: 'window.timeline', panel: 'timeline' },
  ]},
  { label: 'ヘルプ', items: [
    { label: 'openEffect について…', cmd: 'help.about' },
  ]},
];

let openDropdown = null;

function closeDropdown() {
  document.querySelectorAll('.menu-dropdown').forEach(d => d.remove());
  openDropdown = null;
  document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
}

function buildItem(item) {
  if (item === SEP) return el('div', { class: 'menu-sep' });
  const enabled = item.panel ? true : (item.cmd ? isEnabled(item.cmd) : true);
  const checked = item.panel ? state.panels?.[item.panel] !== false : null;
  const row = el('div', { class: 'menu-row' + (enabled ? '' : ' disabled') + (item.submenu ? ' has-sub' : '') },
    el('span', { class: 'menu-check', text: checked ? '✓' : '' }),
    el('span', { class: 'menu-label', text: item.label }),
    item.shortcut ? el('span', { class: 'menu-shortcut', text: item.shortcut }) : null,
    item.submenu ? el('span', { class: 'menu-sub-arrow', text: '▸' }) : null,
  );
  let subTimer = null;
  row.addEventListener('mouseenter', () => {
    clearTimeout(subTimer);
    // 自分のサブメニュー・祖先のサブメニューは閉じない (自己破壊防止)
    const foreign = [...document.querySelectorAll('.menu-dropdown.sub')].filter(d => d !== row._sub && !d.contains(row));
    if (!item.submenu || !enabled) {
      // サブメニューを持たない行: 開いている他サブメニューは遅れて閉じる (斜め移動で消える対策)
      if (foreign.length) subTimer = setTimeout(() => foreign.forEach(d => d.remove()), 300);
      return;
    }
    subTimer = setTimeout(() => {
      foreign.forEach(d => d.remove());
      if (row._sub && row._sub.isConnected) return;
      const sub = buildDropdown(item.submenu, true);
      const r = row.getBoundingClientRect();
      sub.style.left = (r.right - 2) + 'px';
      sub.style.top = Math.max(0, Math.min(r.top - 3, window.innerHeight - item.submenu.length * 24 - 10)) + 'px';
      document.body.append(sub);
      row._sub = sub;
    }, foreign.length ? 300 : 80);
  });
  row.addEventListener('mouseleave', () => clearTimeout(subTimer));
  row.addEventListener('click', e => {
    e.stopPropagation();
    if (!enabled || item.submenu) return;
    closeDropdown();
    runCommand(item.cmd);
  });
  return row;
}

function buildDropdown(items, isSub = false) {
  const dd = el('div', { class: 'menu-dropdown' + (isSub ? ' sub' : '') });
  items.forEach(item => dd.append(buildItem(item)));
  return dd;
}

export function initMenubar(container) {
  const bar = el('div', { class: 'menubar' });
  // AE 風ロゴ
  bar.append(el('div', { class: 'app-logo', text: 'Oe', title: 'openEffect' }));
  for (const menu of MENUS) {
    const item = el('div', { class: 'menu-item', text: menu.label });
    item.addEventListener('click', () => {
      if (openDropdown && item.classList.contains('open')) { closeDropdown(); return; }
      closeDropdown();
      const dd = buildDropdown(menu.items);
      const r = item.getBoundingClientRect();
      dd.style.left = r.left + 'px';
      dd.style.top = r.bottom + 'px';
      document.body.append(dd);
      openDropdown = dd;
      item.classList.add('open');
    });
    item.addEventListener('mouseenter', () => {
      if (!openDropdown) return;
      closeDropdown();
      const dd = buildDropdown(menu.items);
      const r = item.getBoundingClientRect();
      dd.style.left = r.left + 'px';
      dd.style.top = r.bottom + 'px';
      document.body.append(dd);
      openDropdown = dd;
      item.classList.add('open');
    });
    bar.append(item);
  }
  container.append(bar);
  document.addEventListener('mousedown', e => {
    if (openDropdown && !e.target.closest('.menu-dropdown') && !e.target.closest('.menu-item')) closeDropdown();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDropdown();
  });
}
