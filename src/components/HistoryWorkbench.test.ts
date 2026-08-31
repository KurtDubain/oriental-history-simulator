import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '../sim';
import {
  archiveDecodeCacheEntryCount,
  clearWorldArchiveDecodeCache,
  compactWorldArchive,
  createWorldArchiveState,
} from '../sim/archive';
import type { HistoryEvent } from '../sim/types';
import { HistoryWorkbench } from './HistoryWorkbench';

function event(id: string, turn: number, title: string): HistoryEvent {
  return {
    id,
    turn,
    year: Math.floor(turn / 4) + 1,
    season: ['春', '夏', '秋', '冬'][turn % 4] as HistoryEvent['season'],
    category: '世界',
    kind: 'history_workbench_test',
    title,
    summary: `${title}的确切记载。`,
    importance: 2,
    actorIds: [],
    polityIds: [],
    regionIds: [],
    causes: [],
    evidence: [],
    stateDeltas: [],
    sourceFactIds: [],
    situationIds: [],
  };
}

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
    expect(openMarkup).toContain('data-history-layer="chronicle"');
    expect(openMarkup).toContain('长期史册');
    expect(openMarkup).toContain('天下史册');
    expect(openMarkup).toContain('type="search"');
    expect(openMarkup).toContain('type="range"');
    expect(openMarkup).toContain('历史事件检索结果');
    expect(openMarkup).toContain('为何如此');
    expect(openMarkup).not.toContain('查明因果');

    const closedMarkup = renderToStaticMarkup(createElement(HistoryWorkbench, { ...props, open: false }));
    expect(closedMarkup).toBe('');
  });

  it('renders the hot first screen without synchronously decoding a cold block', () => {
    const world = createWorld('史册首屏冷卷测试');
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    world.facts = [];
    world.history = [
      event('event_000001', 2, '旧卷中的早年史事'),
      event('event_000002', 70, '近年仍在案头的史事'),
    ];
    world.archiveSystem = createWorldArchiveState();
    compactWorldArchive(world);
    expect(world.history.some((entry) => entry.id === 'event_000001')).toBe(false);
    clearWorldArchiveDecodeCache();

    const markup = renderToStaticMarkup(createElement(HistoryWorkbench, {
      open: true,
      world,
      onSelectEvent: vi.fn(),
      onTurnChange: vi.fn(),
      onClose: vi.fn(),
      onReset: vi.fn(),
    }));

    expect(markup).toContain('近年仍在案头的史事');
    expect(markup).not.toContain('旧卷中的早年史事');
    expect(markup).toContain('已找到1件，仍在翻检旧卷');
    expect(markup).toContain('aria-busy="true"');
    expect(archiveDecodeCacheEntryCount()).toBe(0);
  });
});
