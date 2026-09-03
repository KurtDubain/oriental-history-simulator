import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld } from '../sim';
import { projectSituationWorkbench } from '../view/situation-detail';
import { SituationWorkbench } from './SituationWorkbench';

describe('SituationWorkbench', () => {
  it('renders concrete facts without exposing detector stages or audit metrics', () => {
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
    expect(markup).toContain('data-history-layer="situation"');
    expect(markup).toContain('持续局势');
    expect(markup).toContain('最近实事');
    expect(markup).toContain('此前实事');
    expect(markup).toContain('相关各方');
    expect(markup).toContain('data-testid="situation-current-action"');
    expect(markup).toContain('data-testid="situation-participants-disclosure"');
    expect(markup).toContain('所据史实');
    expect(markup).toContain('为何如此');
    expect(markup).not.toContain('查明因果');
    expect(markup).not.toContain('推演底账');
    expect(markup).not.toContain('当前张力');
    expect(markup).not.toContain('局势转入新阶段');
    expect(markup).not.toContain('class="situation-workbench__phase"');
    expect(markup).not.toContain('class="situation-workbench__audit"');
    expect(markup).toContain(projection.selected?.title ?? '');
    const sceneIds = [...markup.matchAll(/data-narrative-scene-id="([^"]+)"/g)].map((match) => match[1]);
    expect(sceneIds).toHaveLength(new Set(sceneIds).size);
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

  it('lets an open Situation be followed from its own dossier', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);
    const situation = world.situationSystem.situations.find((item) => item.status === 'open');
    if (!situation) throw new Error('expected an open Situation');
    const projection = projectSituationWorkbench(world, situation.id);
    const markup = renderToStaticMarkup(createElement(SituationWorkbench, {
      open: true,
      projection,
      isWatched: true,
      onToggleWatch: () => undefined,
      onClose: () => undefined,
      onSelectSituation: () => undefined,
      onSelectEntity: () => undefined,
      onSelectHistoryEvent: () => undefined,
    }));

    expect(markup).toContain('class="situation-workbench__watch"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('已关注');
  });

  it('turns an explicit faction participant into an exact living-court link', () => {
    const world = advanceWorldBy(createWorld('朝局卷宗精确往返'), 4);
    const projection = projectSituationWorkbench(world);
    const selected = projection.selected;
    const faction = world.factions.find((item) => item.active && world.polities.some((polity) => polity.id === item.polityId && polity.alive));
    if (!selected || !faction) throw new Error('expected a selected Situation and an active faction');
    const polity = world.polities.find((item) => item.id === faction.polityId);
    if (!polity) throw new Error('expected faction polity');
    const focusedProjection = {
      ...projection,
      selected: {
        ...selected,
        participants: [
          ...selected.participants.filter((group) => group.key !== 'factionIds'),
          { key: 'factionIds' as const, label: '朝局派系', entities: [{ id: faction.id, label: faction.name }] },
        ],
        politicalFocus: [{
          polityId: polity.id,
          polityName: polity.name,
          factionId: faction.id,
          factionName: faction.name,
          active: true,
          detail: '卷宗的参与派系列有此派',
        }],
      },
    };
    const markup = renderToStaticMarkup(createElement(SituationWorkbench, {
      open: true,
      projection: focusedProjection,
      onClose: () => undefined,
      onSelectSituation: () => undefined,
      onSelectEntity: () => undefined,
      onSelectHistoryEvent: () => undefined,
      onSelectCourtFaction: () => undefined,
    }));

    expect(markup).toContain(`data-court-focus-polity="${polity.id}"`);
    expect(markup).toContain(`data-court-focus-faction="${faction.id}"`);
    expect(markup).toContain('看其朝局');
  });
});
