import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'summary:not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface DialogLayerOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement>;
  initialFocusRef?: RefObject<HTMLElement>;
  onClose?: () => void;
  /** Return true when a local sub-state consumed Escape. */
  onEscape?: () => boolean;
  returnFocusTo?: HTMLElement | null;
  shouldRestoreFocus?: () => boolean;
}

function visibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.offsetParent !== null && !element.closest('[inert]'));
}

/** Shared keyboard, initial-focus and focus-return contract for blocking pages. */
export function useDialogLayer({
  open,
  containerRef,
  initialFocusRef,
  onClose,
  onEscape,
  returnFocusTo,
  shouldRestoreFocus,
}: DialogLayerOptions): void {
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  const shouldRestoreFocusRef = useRef(shouldRestoreFocus);
  onCloseRef.current = onClose;
  onEscapeRef.current = onEscape;
  shouldRestoreFocusRef.current = shouldRestoreFocus;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = returnFocusTo ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const target = initialFocusRef?.current
        ?? (container ? visibleFocusable(container)[0] : null)
        ?? container;
      target?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        if (onEscapeRef.current?.()) return;
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      const focusable = visibleFocusable(containerRef.current);
      if (!focusable.length) {
        event.preventDefault();
        containerRef.current.focus({ preventScroll: true });
        return;
      }
      const activeIndex = document.activeElement instanceof HTMLElement
        ? focusable.indexOf(document.activeElement)
        : -1;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex >= focusable.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (!previouslyFocused || shouldRestoreFocusRef.current?.() === false) return;
      queueMicrotask(() => {
        if (previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
      });
    };
  }, [containerRef, initialFocusRef, open, returnFocusTo]);
}
