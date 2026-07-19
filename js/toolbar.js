// ツールバー (AE 風ツールボックス)
import { el } from './utils.js';
import { state, emit } from './state.js';

const ICONS = {
  selection: '<svg viewBox="0 0 16 16"><path d="M4 1 L4 13 L7 10 L9 14 L11 13 L9 9 L13 9 Z" fill="currentColor"/></svg>',
  hand: '<svg viewBox="0 0 16 16"><path d="M6 7 V3 a1 1 0 0 1 2 0 V6 V2 a1 1 0 0 1 2 0 V6 V3 a1 1 0 0 1 2 0 V8 a1 1 0 0 1 2 0 V11 a5 5 0 0 1 -5 4 H8 a5 5 0 0 1 -4 -2 L2.5 10 a1 1 0 0 1 1.5 -1.3 L6 11 Z" fill="currentColor" transform="translate(0,-1)"/></svg>',
  zoom: '<svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="10" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.8"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" stroke-width="1.4"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  rotate: '<svg viewBox="0 0 16 16"><path d="M8 2 a6 6 0 1 1 -5.6 4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 1 L2.5 6.5 L7 4.5 Z" fill="currentColor"/></svg>',
  text: '<svg viewBox="0 0 16 16"><path d="M2 3 H14 V5.5 H12.5 V4 H9 V12.5 H11 V13.5 H5 V12.5 H7 V4 H3.5 V5.5 H2 Z" fill="currentColor"/></svg>',
  rect: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  ellipse: '<svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="6.5" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

const TOOLS = [
  { id: 'selection', key: 'V', label: '選択ツール' },
  { id: 'hand', key: 'H', label: 'ハンドツール' },
  { id: 'zoom', key: 'Z', label: 'ズームツール' },
  { id: 'rotate', key: 'W', label: '回転ツール' },
  { id: 'text', key: 'T', label: '横書き文字ツール' },
  { id: 'rect', key: 'Q', label: '長方形ツール' },
  { id: 'ellipse', key: 'Shift+Q', label: '楕円ツール' },
];

export function initToolbar(container) {
  const bar = el('div', { class: 'toolbar' });
  for (const tool of TOOLS) {
    const btn = el('button', {
      class: 'tool-btn' + (state.tool === tool.id ? ' active' : ''),
      title: `${tool.label} (${tool.key})`,
      html: ICONS[tool.id],
      dataset: { tool: tool.id },
      on: {
        click: () => setTool(tool.id),
      },
    });
    bar.append(btn);
  }
  // 塗りカラー (シェイプ作成用)
  const fill = el('input', {
    type: 'color', class: 'tool-fill', title: 'シェイプの塗りカラー',
    value: state.shapeFill,
    on: { input: e => { state.shapeFill = e.target.value; } },
  });
  bar.append(fill);

  bar.append(el('div', { class: 'toolbar-spacer' }));
  bar.append(el('div', { class: 'workspace-label' },
    el('span', { class: 'ws-caption', text: 'ワークスペース: ' }),
    el('span', { class: 'ws-name', text: '標準' })));

  container.append(bar);

  function refresh() {
    bar.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === state.tool);
    });
    const shapeTool = ['rect', 'ellipse'].includes(state.tool);
    fill.style.visibility = shapeTool ? 'visible' : 'hidden';
  }
  refresh();
  document.addEventListener('openEffect:tool', refresh);
}

export function setTool(id) {
  state.tool = id;
  emit('tool');
  document.dispatchEvent(new CustomEvent('openEffect:tool'));
}

export function toolFromKey(key, shift) {
  const k = key.toUpperCase();
  if (k === 'Q' && shift) return 'ellipse';
  const t = TOOLS.find(t => t.key === k);
  return t?.id || null;
}
