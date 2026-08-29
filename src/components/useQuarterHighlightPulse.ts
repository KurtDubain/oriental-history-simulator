import { useEffect, useRef, useState } from 'react';

export interface QuarterHighlightPulseOptions {
  epoch: string | number;
  regionIds: readonly string[];
  motionReduced: boolean;
}

/** Observer-only feedback. The returned strength never enters world state or saves. */
export function useQuarterHighlightPulse({
  epoch,
  regionIds,
  motionReduced,
}: QuarterHighlightPulseOptions): number {
  const [strength, setStrength] = useState(0);
  const lastPulsedEpochRef = useRef<string | number | null>(null);
  const regionKey = regionIds.join('|');

  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    if (!regionKey) {
      setStrength(0);
      return undefined;
    }
    if (Object.is(lastPulsedEpochRef.current, epoch)) {
      setStrength(0);
      return undefined;
    }
    lastPulsedEpochRef.current = epoch;
    const reduced = motionReduced
      || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (reduced) {
      setStrength(0.38);
      settleTimer = window.setTimeout(() => setStrength(0), 760);
      return () => window.clearTimeout(settleTimer);
    }
    const duration = 820;
    const startedAt = window.performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      setStrength(Math.sin(progress * Math.PI) * 0.62);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [epoch, motionReduced, regionKey]);

  return strength;
}
