import { describe, expect, it } from 'vitest';
import { WorldSessionOperationGate } from './use-world-session-controller';

describe('WorldSessionOperationGate', () => {
  it('lets only the latest asynchronous world operation commit', () => {
    const gate = new WorldSessionOperationGate();
    const first = gate.begin('start');
    const second = gate.begin('start');
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('invalidates work when its page journey is closed', () => {
    const gate = new WorldSessionOperationGate();
    const ticket = gate.begin('collection');
    expect(gate.cancel('collection')).toBe(true);
    expect(gate.isCurrent(ticket)).toBe(false);
    expect(gate.finish(ticket)).toBe(false);
  });

  it('does not cancel a different scope', () => {
    const gate = new WorldSessionOperationGate();
    const ticket = gate.begin('start');
    expect(gate.cancel('collection')).toBe(false);
    expect(gate.isCurrent(ticket)).toBe(true);
  });
});
