import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createObserverInterfaceSettings,
  normalizeObserverInterfaceSettings,
  type ObserverInterfaceSettings,
} from '../view/observer-interface-settings';
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel';

const hookHarness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  nextId: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      hookHarness.effects.push(effect);
    },
    useId: () => `settings-test-${hookHarness.nextId += 1}`,
    useRef: <T,>(initialValue: T) => ({ current: initialValue }),
  };
});

interface TestElementProps {
  children?: ReactNode;
  type?: string;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { checked?: boolean; value?: string } }) => void;
}

type TestElement = ReactElement<TestElementProps>;

function panelProps(overrides: Partial<SettingsPanelProps> = {}): SettingsPanelProps {
  return {
    open: true,
    settings: createObserverInterfaceSettings(),
    onSettingsChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function collectElements(node: ReactNode): TestElement[] {
  const collected: TestElement[] = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isValidElement<TestElementProps>(current)) return;
    collected.push(current);
    visit(current.props.children);
  };
  visit(node);
  return collected;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (!isValidElement<TestElementProps>(node)) return '';
  return nodeText(node.props.children);
}

function renderPanel(overrides: Partial<SettingsPanelProps> = {}): ReactElement | null {
  return SettingsPanel(panelProps(overrides));
}

beforeEach(() => {
  hookHarness.effects.length = 0;
  hookHarness.nextId = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPanel', () => {
  it('does not render while closed', () => {
    expect(renderPanel({ open: false })).toBeNull();
  });

  it('keeps all volume sliders disabled until the observer enables sound', () => {
    const root = renderPanel();
    const rangeInputs = collectElements(root).filter((element) => (
      element.type === 'input' && element.props.type === 'range'
    ));

    expect(createObserverInterfaceSettings().sound.enabled).toBe(false);
    expect(rangeInputs).toHaveLength(3);
    expect(rangeInputs.every((element) => element.props.disabled === true)).toBe(true);
  });

  it('emits normalized settings for switches, motion, and density choices', () => {
    const onSettingsChange = vi.fn();
    const malformed = {
      ...createObserverInterfaceSettings(),
      sound: {
        ...createObserverInterfaceSettings().sound,
        masterVolume: 9,
      },
    } as ObserverInterfaceSettings;
    const root = renderPanel({ settings: malformed, onSettingsChange });
    const elements = collectElements(root);
    const checkboxes = elements.filter((element) => (
      element.type === 'input' && element.props.type === 'checkbox'
    ));
    const reducedMotion = elements.find((element) => (
      element.type === 'button' && nodeText(element).includes('减少')
    ));
    const compactDensity = elements.find((element) => (
      element.type === 'button' && nodeText(element).includes('紧凑')
    ));

    expect(checkboxes).toHaveLength(2);
    checkboxes[0].props.onChange?.({ target: { checked: true } });
    checkboxes[1].props.onChange?.({ target: { checked: false } });
    reducedMotion?.props.onClick?.();
    compactDensity?.props.onClick?.();

    expect(onSettingsChange).toHaveBeenNthCalledWith(1, normalizeObserverInterfaceSettings({
      ...malformed,
      sound: { ...malformed.sound, enabled: true },
    }));
    expect(onSettingsChange).toHaveBeenNthCalledWith(2, normalizeObserverInterfaceSettings({
      ...malformed,
      mapAtmosphere: false,
    }));
    expect(onSettingsChange).toHaveBeenNthCalledWith(3, normalizeObserverInterfaceSettings({
      ...malformed,
      motion: 'reduced',
    }));
    expect(onSettingsChange).toHaveBeenNthCalledWith(4, normalizeObserverInterfaceSettings({
      ...malformed,
      interfaceDensity: 'compact',
    }));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    let keydown: ((event: KeyboardEvent) => void) | null = null;
    const documentStub = {
      activeElement: null,
      addEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
        if (type === 'keydown') keydown = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('HTMLElement', class HTMLElementStub {});
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    renderPanel({ onClose });
    const cleanup = hookHarness.effects[0]?.();
    const preventDefault = vi.fn();
    if (!keydown) throw new Error('SettingsPanel did not register its keyboard listener');
    (keydown as (event: KeyboardEvent) => void)(
      { key: 'Escape', preventDefault } as unknown as KeyboardEvent,
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    cleanup?.();
  });

  it('states that settings cannot change the simulated world', () => {
    const root = renderPanel();
    expect(nodeText(root)).toContain('这些设置只属于观察者，不改变人物选择、历史结果或世界种子。');
  });
});
