import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../version';
import { createObserverDeskSettings, type ObserverPauseMatch } from '../view/v1-observer';
import { ObserverDesk } from './ObserverDesk';

const situationMatch: ObserverPauseMatch = {
  eventId: 'situation-pause:fact_9:situation_war:phase-change',
  eventTitle: '燕齐战局转入临界',
  rule: 'situationChanges',
  reason: '关注局势进入临界阶段',
  watchMatches: [{
    kind: 'situation',
    id: 'situation_war',
    label: '燕齐战争进程',
    detail: '临界 · 已追踪九季',
    alert: true,
  }],
  situationId: 'situation_war',
  situationTrigger: 'phase-change',
  sourceFactId: 'fact_9',
};

describe('ObserverDesk Situation UI', () => {
  it('renders a Situation watch as an openable, removable record with a visible alert', () => {
    const settings = createObserverDeskSettings();
    settings.watchlist = [...situationMatch.watchMatches];
    const markup = renderToStaticMarkup(createElement(ObserverDesk, {
      open: true,
      settings,
      onSettingsChange: vi.fn(),
      onClose: vi.fn(),
      onSelectWatchItem: vi.fn(),
      pauseMatch: situationMatch,
      onSelectPauseMatch: vi.fn(),
    }));

    expect(markup).toContain('data-watch-kind="situation"');
    expect(markup).toContain('data-watch-id="situation_war"');
    expect(markup).toContain('data-testid="observer-watch-open"');
    expect(markup).toContain('data-testid="observer-watch-remove"');
    expect(markup).toContain('>局势<');
    expect(markup).toContain('里程碑');
    expect(markup).toContain('data-alert-kind="situation-change"');
  });

  it('exposes the Situation pause rule and a direct route to the matching dossier', () => {
    const markup = renderToStaticMarkup(createElement(ObserverDesk, {
      open: true,
      settings: createObserverDeskSettings(),
      onSettingsChange: vi.fn(),
      onClose: vi.fn(),
      onSelectWatchItem: vi.fn(),
      pauseMatch: situationMatch,
      onSelectPauseMatch: vi.fn(),
    }));

    expect(markup).toContain('data-pause-rule="situationChanges"');
    expect(markup).toContain('关注局势关键变化');
    expect(markup).toContain('形成、阶段变化、核心人物死亡与结案');
    expect(markup).toContain('data-testid="observer-pause-open"');
    expect(markup).toContain('data-situation-id="situation_war"');
    expect(markup).toContain('data-situation-trigger="phase-change"');
    expect(markup).toContain('局势里程碑，时间已停');
    expect(markup).toContain('打开对应局势卷宗');
  });

  it('teaches Situation following in the empty state and local-only footnote', () => {
    const markup = renderToStaticMarkup(createElement(ObserverDesk, {
      open: true,
      settings: createObserverDeskSettings(),
      onSettingsChange: vi.fn(),
      onClose: vi.fn(),
      onSelectWatchItem: vi.fn(),
    }));

    expect(markup).toContain('可在“当世三问”关注一条局势');
    expect(markup).toContain('局势关注、关键变化提醒与暂停仅属于观察者设置');
    expect(markup).not.toContain('data-testid="observer-pause-open"');
  });

  it('keeps version checking inside the desk and exposes one clear update action', () => {
    const markup = renderToStaticMarkup(createElement(ObserverDesk, {
      open: true,
      settings: createObserverDeskSettings(),
      onSettingsChange: vi.fn(),
      onClose: vi.fn(),
      onSelectWatchItem: vi.fn(),
      appUpdate: {
        phase: 'available',
        localVersion: '1.1.0',
        localBuildId: 'build-old',
        remoteVersion: '1.1.1',
        remoteBuildId: 'build-new',
        checkedAt: 1_788_000_000_000,
      },
      onCheckUpdate: vi.fn(),
      onApplyUpdate: vi.fn(),
    }));

    expect(markup).toContain('版本与更新');
    expect(markup).toContain(`v${APP_VERSION}`);
    expect(markup).toContain('发现 v1.1.1');
    expect(markup).toContain('data-testid="apply-app-update"');
    expect(markup).toContain('更新并重载');
    expect(markup).not.toContain('部署探针');
  });
});
