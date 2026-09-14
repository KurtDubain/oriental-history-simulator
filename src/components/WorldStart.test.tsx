import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMapProfiles } from '../maps';
import type { MapProfileId } from '../maps';
import { WorldStart, type WorldStartProps } from './WorldStart';

const footer = vi.hoisted(() => ({ enabled: false }));
vi.mock('../version', async (original) => ({
  ...await original<typeof import('../version')>(),
  get APP_ICP_FOOTER() { return footer.enabled; },
}));
afterEach(() => { footer.enabled = false; });

function renderStart(overrides: Partial<WorldStartProps> = {}): {
  markup: string;
  onCreate: ReturnType<typeof vi.fn>;
  onSelectMapProfile: ReturnType<typeof vi.fn>;
} {
  const onCreate = vi.fn();
  const onSelectMapProfile = vi.fn();
  const props: WorldStartProps = {
    open: true,
    seed: '双图验收',
    selectedMapProfileId: 'private-v03',
    onSelectMapProfile,
    hasSave: true,
    onSeedChange: vi.fn(),
    onCreate,
    onContinue: vi.fn(),
    onOpenCollection: vi.fn(),
    collectionCount: 3,
    onImport: vi.fn(),
    ...overrides,
  };
  return {
    markup: renderToStaticMarkup(createElement(WorldStart, props)),
    onCreate,
    onSelectMapProfile,
  };
}

describe('WorldStart map profile selection', () => {
  it.each([false, true])('shows only the opt-in filing link on the homepage (hasSave=%s)', (hasSave) => {
    expect(renderStart({ hasSave }).markup).not.toContain('beian.miit.gov.cn');
    footer.enabled = true;
    const { markup } = renderStart({ hasSave });
    expect(markup).toMatch(/<a[^>]+href="https:\/\/beian\.miit\.gov\.cn\/"[^>]*>冀ICP备2023028175号-1<\/a>/);
    expect(markup.match(/冀ICP备2023028175号-1/g)).toHaveLength(1);
    expect(markup.includes('id="continue-world"')).toBe(hasSave);
    expect(renderStart({ open: false }).markup).toBe('');
  });

  it('presents both registered atlases with a real outline, scale and playstyle before the seed', () => {
    const profiles = listMapProfiles();
    const { markup, onCreate, onSelectMapProfile } = renderStart();

    expect(profiles).toHaveLength(2);
    expect(markup.match(/data-map-profile-id=/g)).toHaveLength(2);
    expect(markup.match(/class="world-start__map-svg"/g)).toHaveLength(2);
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    for (const profile of profiles) {
      expect(markup).toContain(`data-map-profile-id="${profile.id}"`);
      expect(markup).toContain(profile.name);
      expect(markup).toContain(profile.subtitle);
      expect(markup).toContain(`${profile.simulation.regions.length}州 · ${profile.simulation.seaZones.length}海`);
    }
    expect(markup.match(/class="world-start__map-copy"/g)).toHaveLength(2);
    expect(markup.match(/<small id="world-map-[^"]+-detail">[^<]+<\/small>/g)).toHaveLength(2);
    expect(markup.indexOf('world-start__map-options')).toBeLessThan(markup.indexOf('world-start__seed'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSelectMapProfile).not.toHaveBeenCalled();
  });

  it('is controlled by the parent and reflects the selected atlas without hiding continuation tools', () => {
    const selectedMapProfileId: MapProfileId = 'contest-v01';
    const { markup } = renderStart({ selectedMapProfileId });

    expect(markup).toContain('data-selected="true" data-map-profile-id="contest-v01"');
    expect(markup).toMatch(/checked="" value="contest-v01"/);
    expect(markup).toContain('云海八荒 · 68 陆区 · 10 海域');
    expect(markup).toContain('id="continue-world"');
    expect(markup).toContain('id="open-world-collection"');
    expect(markup).toContain('世界收藏 · 3');
    expect(markup).toContain('导入史册');
  });

  it('disables map choices with the rest of the creation controls while work is in progress', () => {
    const { markup } = renderStart({ busy: true });
    const disabledCount = markup.match(/disabled=""/g)?.length ?? 0;

    expect(disabledCount).toBeGreaterThanOrEqual(8);
    expect(markup).toContain('name="world-map-profile"');
    expect(markup).toContain('选图不会落笔；确认开启后，才会按种子生成这段历史');
  });
});
