import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRosterDossierReturnTarget,
  focusRosterDossierReturnTarget,
} from './use-roster-dossier-flow';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('roster dossier return contract', () => {
  it('records only compact people and powers rosters', () => {
    expect(createRosterDossierReturnTarget('people', 'polities', 'person-gu', true)).toEqual({
      view: 'people',
      section: null,
      itemId: 'person-gu',
    });
    expect(createRosterDossierReturnTarget('powers', 'families', 'family-gu', true)).toEqual({
      view: 'powers',
      section: 'families',
      itemId: 'family-gu',
    });
    expect(createRosterDossierReturnTarget('world', 'polities', 'region-yan', true)).toBeNull();
    expect(createRosterDossierReturnTarget('chronicle', 'polities', 'event-1', true)).toBeNull();
    expect(createRosterDossierReturnTarget('people', 'polities', 'person-gu', false)).toBeNull();
  });

  it('restores the exact roster row without interpolating its id into a selector', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const matchingRow = {
      dataset: { rosterId: 'person-顾[一]' },
      scrollIntoView,
      focus,
    } as unknown as HTMLElement;
    const otherRow = {
      dataset: { rosterId: 'person-other' },
    } as unknown as HTMLElement;
    const querySelectorAll = vi.fn(() => [otherRow, matchingRow]);
    const querySelector = vi.fn(() => ({ querySelectorAll }));
    vi.stubGlobal('document', { querySelector });

    expect(focusRosterDossierReturnTarget({
      view: 'people',
      section: null,
      itemId: 'person-顾[一]',
    })).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('.roster-panel[data-roster-scope="people"]');
    expect(querySelectorAll).toHaveBeenCalledWith('[data-roster-id]');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back to the roster search when the original row no longer exists', () => {
    const focus = vi.fn();
    const scope = {
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => ({ focus })),
    };
    vi.stubGlobal('document', { querySelector: vi.fn(() => scope) });

    expect(focusRosterDossierReturnTarget({
      view: 'powers',
      section: 'military',
      itemId: 'army-departed',
    })).toBe(true);
    expect(scope.querySelector).toHaveBeenCalledWith('.roster-panel__search input');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
