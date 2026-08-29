import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavigationRail } from './NavigationRail';

function renderRail(activeView: 'world' | 'powers' | 'people' | 'chronicle' = 'world', militaryAlertCount = 0): string {
  return renderToStaticMarkup(createElement(NavigationRail, {
    activeView,
    activeOverlay: 'political',
    militaryAlertCount,
    onViewChange: () => undefined,
    onOverlayChange: () => undefined,
  }));
}

describe('NavigationRail TRIM01 contract', () => {
  it('keeps exactly five constant entries in the intended reading order', () => {
    const markup = renderRail();
    const entries = [...markup.matchAll(/data-navigation-entry="([^"]+)"/g)].map((match) => match[1]);

    expect(entries).toEqual(['world', 'powers', 'people', 'chronicle', 'layers']);
    expect(markup).not.toContain('data-observer-view="polities"');
    expect(markup).not.toContain('data-observer-view="families"');
    expect(markup).not.toContain('data-observer-view="military"');
  });

  it('owns the only global history trigger and folds military alerts into powers', () => {
    const markup = renderRail('powers', 12);

    expect(markup.match(/data-history-workbench-trigger="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-observer-view="powers" data-navigation-entry="powers"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('军旅有 12 条战事消息');
    expect(markup).toContain('>9+<');
  });
});
