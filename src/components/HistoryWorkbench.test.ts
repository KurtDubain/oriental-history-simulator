import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '../sim';
import { HistoryWorkbench } from './HistoryWorkbench';

describe('HistoryWorkbench shell', () => {
  it('renders an accessible searchable timeline only while open', () => {
    const world = createWorld('V1 历史工作台组件测试');
    const props = {
      world,
      onSelectEvent: vi.fn(),
      onTurnChange: vi.fn(),
      onClose: vi.fn(),
      onReset: vi.fn(),
    };

    const openMarkup = renderToStaticMarkup(createElement(HistoryWorkbench, { ...props, open: true }));
    expect(openMarkup).toContain('role="dialog"');
    expect(openMarkup).toContain('历史工作台');
    expect(openMarkup).toContain('type="search"');
    expect(openMarkup).toContain('type="range"');
    expect(openMarkup).toContain('历史事件检索结果');

    const closedMarkup = renderToStaticMarkup(createElement(HistoryWorkbench, { ...props, open: false }));
    expect(closedMarkup).toBe('');
  });
});
