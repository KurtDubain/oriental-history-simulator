import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CountryInspectorData } from './Inspector';
import { Inspector } from './Inspector';
import { CourtProjection } from './CourtProjection';
import type { CourtProjectionView } from '../view/court-projection';
import type { CourtFocusRequest } from '../view/observer-navigation';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  setters: [] as Array<(value: unknown) => void>,
  effectDeps: [] as Array<readonly unknown[] | undefined>,
  stateCursor: 0,
  effectCursor: 0,
  idCursor: 0,
  begin() {
    this.stateCursor = 0;
    this.effectCursor = 0;
    this.idCursor = 0;
  },
  reset() {
    this.states = [];
    this.setters = [];
    this.effectDeps = [];
    this.begin();
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const equalDeps = (left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) => (
    left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
  );
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.stateCursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      const setter = (next: unknown) => {
        hooks.states[index] = typeof next === 'function'
          ? (next as (current: unknown) => unknown)(hooks.states[index])
          : next;
      };
      hooks.setters[index] = setter;
      return [hooks.states[index], setter];
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = hooks.effectCursor++;
      const previous = hooks.effectDeps[index];
      hooks.effectDeps[index] = deps;
      if (!equalDeps(previous, deps)) effect();
    },
    useMemo<T>(factory: () => T) {
      return factory();
    },
    useCallback<T>(callback: T) {
      return callback;
    },
    useRef<T>(initial: T) {
      return { current: initial };
    },
    useId() {
      hooks.idCursor += 1;
      return `political-entry-${hooks.idCursor}`;
    },
  };
});

const court: CourtProjectionView = {
  polityId: 'polity-yan',
  summary: '顾庭芳居君位；宣政社居朝中首位。',
  ruler: null,
  seats: [],
  factionPositions: [{
    factionId: 'faction-a',
    name: '宣政社',
    leaderId: 'person-a',
    leader: '隋行简',
    agenda: '整饬吏治',
    power: 62,
    cohesion: 71,
    seatIds: [],
    seatLabels: [],
    nearestBand: 1,
    positionLabel: '近班',
    dominant: true,
    foundedLabel: '初元元年春立派',
    topRoots: [{ key: 'regional_office', label: '地方任官', value: 12 }],
    recentMovement: null,
  }],
  graphFactionIds: ['faction-a'],
  relations: [],
};

const secondPosition: CourtProjectionView['factionPositions'][number] = {
  factionId: 'faction-b',
  name: '清议社',
  leaderId: 'person-b',
  leader: '裴观澜',
  agenda: '约束权门',
  power: 41,
  cohesion: 66,
  seatIds: [],
  seatLabels: [],
  nearestBand: 3,
  positionLabel: '外班',
  dominant: false,
  foundedLabel: '初元二年秋立派',
  topRoots: [{ key: 'family_network', label: '门第声望', value: 17 }],
  recentMovement: null,
};

const twoFactionCourt: CourtProjectionView = {
  ...court,
  factionPositions: [...court.factionPositions, secondPosition],
  graphFactionIds: ['faction-a', 'faction-b'],
};

const country: CountryInspectorData = {
  id: 'polity-yan',
  name: '燕国',
  ruler: '顾庭芳',
  capital: '云京',
  population: 12_000,
  treasury: 900,
  food: 18_000,
  regionCount: 4,
  legitimacy: 70,
  centralAuthority: 65,
  administration: 62,
  court,
  factions: [{
    id: 'faction-a',
    name: '宣政社',
    kind: '官僚',
    leaderId: 'person-a',
    leader: '隋行简',
    power: 62,
    cohesion: 71,
    agenda: '整饬吏治',
  }, {
    id: 'faction-b',
    name: '清议社',
    kind: '士人',
    leaderId: 'person-b',
    leader: '裴观澜',
    power: 41,
    cohesion: 66,
    agenda: '约束权门',
  }],
};

function renderCountry(initialTab?: 'court', tabRequestKey?: number, courtFocus?: CourtFocusRequest) {
  hooks.begin();
  return renderToStaticMarkup(createElement(Inspector, {
    kind: 'country',
    data: country,
    initialTab,
    tabRequestKey,
    courtFocus,
  }));
}

function renderProjection(
  projection: CourtProjectionView,
  focusRequest?: CourtFocusRequest,
): ReactElement<Record<string, unknown>> {
  hooks.begin();
  return CourtProjection({
    court: projection,
    factions: country.factions ?? [],
    focusRequest,
  }) as ReactElement<Record<string, unknown>>;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children as ReactNode, predicate);
}

beforeEach(() => hooks.reset());

describe('country political map entry', () => {
  it('opens an ordinary country dossier on 国势 and a capital request directly on 朝局', () => {
    const ordinary = renderCountry();
    expect(ordinary).toContain('国计');
    expect(ordinary).not.toContain('data-testid="court-projection"');

    hooks.reset();
    const capitalRequest = renderCountry('court', 1);
    expect(capitalRequest).toContain('data-testid="court-projection"');
    expect(capitalRequest).toContain('朝局速览');
    expect(capitalRequest).toContain('看朝局');
    expect(capitalRequest).not.toContain('国计');
  });

  it('uses a changed request token to reopen 朝局 for the same country', () => {
    renderCountry('court', 1);
    const countryTabIndex = hooks.states.findIndex((state) => state === 'court');
    expect(countryTabIndex).toBeGreaterThanOrEqual(0);

    hooks.setters[countryTabIndex]('realm');
    expect(renderCountry('court', 1)).toContain('国计');

    renderCountry('court', 2);
    const reopened = renderCountry('court', 2);
    expect(reopened).toContain('data-testid="court-projection"');
    expect(reopened).not.toContain('国计');
  });

  it('lets a precise focus request open 朝局 without a separate tab hint', () => {
    const request = { requestKey: 1, polityId: country.id, factionId: 'faction-a' };
    const markup = renderCountry(undefined, undefined, request);

    expect(markup).toContain('data-testid="court-projection"');
    expect(markup).toContain('data-court-focused-faction-id="faction-a"');
    expect(markup).toContain('朝局速览');
    expect(markup).toContain('看朝局');
  });

  it('replays only changed request keys and precisely replaces a local faction focus', () => {
    const firstRequest = { requestKey: 1, polityId: court.polityId, factionId: 'faction-b' };
    let tree = renderProjection(twoFactionCourt, firstRequest);
    expect(tree.props['data-court-focused-faction-id']).toBe('faction-b');

    const firstRank = findElement(tree, (element) => element.props['data-court-rank'] === 'faction-a');
    (firstRank?.props.onClick as (() => void) | undefined)?.();
    tree = renderProjection(twoFactionCourt, firstRequest);
    expect(tree.props['data-court-focused-faction-id']).toBe('faction-a');

    const replayedRequest = { ...firstRequest, requestKey: 2 };
    renderProjection(twoFactionCourt, replayedRequest);
    tree = renderProjection(twoFactionCourt, replayedRequest);
    expect(tree.props['data-court-focused-faction-id']).toBe('faction-b');
  });

  it('fails closed on a changed invalid request and does not select the first faction', () => {
    renderProjection(twoFactionCourt, {
      requestKey: 1,
      polityId: court.polityId,
      factionId: 'faction-b',
    });
    const invalidRequest = {
      requestKey: 2,
      polityId: 'polity-wu',
      factionId: 'faction-a',
    };
    renderProjection(twoFactionCourt, invalidRequest);
    const tree = renderProjection(twoFactionCourt, invalidRequest);

    expect(tree.props['data-court-focus-state']).toBe('unavailable');
    expect(tree.props['data-court-focused-faction-id']).toBeUndefined();
  });

  it('falls back honestly, then reaches an empty state when a local focus disappears', () => {
    let tree = renderProjection(twoFactionCourt);
    const secondRank = findElement(tree, (element) => element.props['data-court-rank'] === 'faction-b');
    (secondRank?.props.onClick as (() => void) | undefined)?.();
    tree = renderProjection(twoFactionCourt);
    expect(tree.props['data-court-focused-faction-id']).toBe('faction-b');

    const onlyFirstFaction = {
      ...twoFactionCourt,
      factionPositions: court.factionPositions,
      graphFactionIds: court.graphFactionIds,
    };
    renderProjection(onlyFirstFaction);
    tree = renderProjection(onlyFirstFaction);
    expect(tree.props['data-court-focused-faction-id']).toBe('faction-a');

    const emptyCourt = {
      ...onlyFirstFaction,
      ruler: null,
      seats: [],
      factionPositions: [],
      graphFactionIds: [],
    };
    renderProjection(emptyCourt);
    tree = renderProjection(emptyCourt);
    expect(tree.props['data-court-focus-state']).toBe('empty');
    expect(tree.props['data-court-focused-faction-id']).toBeUndefined();
  });

  it('returns the currently focused faction from the 舆图看根基 action', () => {
    const onShowFactionRoots = vi.fn();
    hooks.begin();
    const tree = CourtProjection({
      court,
      factions: country.factions ?? [],
      onShowFactionRoots,
    });
    const button = findElement(tree, (element) => element.props['data-court-map-roots'] === 'faction-a');
    expect(button).not.toBeNull();

    (button?.props.onClick as (() => void) | undefined)?.();
    expect(onShowFactionRoots).toHaveBeenCalledOnce();
    expect(onShowFactionRoots).toHaveBeenCalledWith('faction-a');
  });
});
