import { useCallback, useRef, useState } from 'react';

export type WorldSessionScope = 'start' | 'collection';

export interface WorldSessionTicket {
  id: number;
  scope: WorldSessionScope;
}

export class WorldSessionOperationGate {
  private epoch = 0;
  private current: WorldSessionTicket | null = null;

  begin(scope: WorldSessionScope): WorldSessionTicket {
    this.current = { id: ++this.epoch, scope };
    return this.current;
  }

  isCurrent(ticket: WorldSessionTicket): boolean {
    return this.current?.id === ticket.id && this.current.scope === ticket.scope;
  }

  finish(ticket: WorldSessionTicket): boolean {
    if (!this.isCurrent(ticket)) return false;
    this.current = null;
    return true;
  }

  cancel(scope?: WorldSessionScope): boolean {
    if (!this.current || (scope && this.current.scope !== scope)) return false;
    this.epoch += 1;
    this.current = null;
    return true;
  }

  active(): WorldSessionTicket | null {
    return this.current;
  }
}

export interface WorldSessionController {
  operation: WorldSessionTicket | null;
  begin: (scope: WorldSessionScope) => WorldSessionTicket;
  isCurrent: (ticket: WorldSessionTicket) => boolean;
  commit: (ticket: WorldSessionTicket, action: () => void) => boolean;
  finish: (ticket: WorldSessionTicket) => void;
  cancel: (scope?: WorldSessionScope) => void;
  isBusy: (scope: WorldSessionScope) => boolean;
}

/** Arbitrates asynchronous world replacements so stale work cannot seize the UI. */
export function useWorldSessionController(): WorldSessionController {
  const gateRef = useRef(new WorldSessionOperationGate());
  const [operation, setOperation] = useState<WorldSessionTicket | null>(null);

  const begin = useCallback((scope: WorldSessionScope) => {
    const ticket = gateRef.current.begin(scope);
    setOperation(ticket);
    return ticket;
  }, []);
  const isCurrent = useCallback((ticket: WorldSessionTicket) => (
    gateRef.current.isCurrent(ticket)
  ), []);
  const commit = useCallback((ticket: WorldSessionTicket, action: () => void) => {
    if (!gateRef.current.isCurrent(ticket)) return false;
    action();
    return true;
  }, []);
  const finish = useCallback((ticket: WorldSessionTicket) => {
    if (gateRef.current.finish(ticket)) setOperation(null);
  }, []);
  const cancel = useCallback((scope?: WorldSessionScope) => {
    if (gateRef.current.cancel(scope)) setOperation(null);
  }, []);
  const isBusy = useCallback((scope: WorldSessionScope) => operation?.scope === scope, [operation]);

  return { operation, begin, isCurrent, commit, finish, cancel, isBusy };
}
