import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld } from '../sim';
import { projectSituationWorkbench } from '../view/situation-detail';
import { SituationWorkbench } from './SituationWorkbench';

describe('SituationWorkbench', () => {
  it('renders the player, evidence, and collapsed audit layers from a real Situation', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);
    const war = world.situationSystem.situations.find((item) => item.type === 'war_progress');
    if (!war) throw new Error('expected war Situation');
    const projection = projectSituationWorkbench(world, war.id);
    const markup = renderToStaticMarkup(createElement(SituationWorkbench, {
      open: true,
      projection,
      onClose: () => undefined,
      onSelectSituation: () => undefined,
      onSelectEntity: () => undefined,
      onSelectHistoryEvent: () => undefined,
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('眼下局面');
    expect(markup).toContain('后续看点');
    expect(markup).toContain('历史转折');
    expect(markup).toContain('历史凭证');
    expect(markup).toContain('推演底账');
    expect(markup).toContain(projection.selected?.title ?? '');
    expect(markup).toMatch(/<details class="situation-workbench__audit">/);
    expect(markup).not.toMatch(/<details class="situation-workbench__audit" open/);
  });

  it('does not render a layer while closed', () => {
    const world = createWorld('局势全卷关闭态');
    const markup = renderToStaticMarkup(createElement(SituationWorkbench, {
      open: false,
      projection: projectSituationWorkbench(world),
      onClose: () => undefined,
      onSelectSituation: () => undefined,
      onSelectEntity: () => undefined,
      onSelectHistoryEvent: () => undefined,
    }));
    expect(markup).toBe('');
  });
});
