import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { PlaybackSpeed } from '../components/TopBar';

export type ObserverAdvanceSource = 'manual' | 'auto' | 'primer';

export interface ObserverPlaybackController {
  running: boolean;
  speed: PlaybackSpeed;
  pause: () => void;
  toggle: () => boolean;
  changeSpeed: (speed: PlaybackSpeed) => void;
  advanceExternalClock: (milliseconds: number) => void;
}

/**
 * Owns the wall-clock side of autoplay. Simulation advancement remains an
 * injected command, keeping this controller strictly observer-only.
 */
export function useObserverPlayback(
  advanceRef: MutableRefObject<(source: ObserverAdvanceSource) => boolean>,
  baseIntervalMs: number,
): ObserverPlaybackController {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const runningRef = useRef(false);
  const speedRef = useRef<PlaybackSpeed>(1);
  const accumulatorRef = useRef(0);
  const externalClockUntilRef = useRef(0);

  const pause = useCallback(() => {
    runningRef.current = false;
    accumulatorRef.current = 0;
    setRunning(false);
  }, []);

  const toggle = useCallback(() => {
    const next = !runningRef.current;
    runningRef.current = next;
    if (!next) accumulatorRef.current = 0;
    setRunning(next);
    return next;
  }, []);

  const changeSpeed = useCallback((nextSpeed: PlaybackSpeed) => {
    speedRef.current = nextSpeed;
    setSpeed(nextSpeed);
  }, []);

  const driveClock = useCallback((milliseconds: number) => {
    if (!runningRef.current || milliseconds <= 0) return;
    accumulatorRef.current += Math.min(milliseconds, 60_000);
    let steps = 0;
    while (runningRef.current && steps < 32) {
      const interval = baseIntervalMs / speedRef.current;
      if (accumulatorRef.current < interval) break;
      accumulatorRef.current -= interval;
      if (!advanceRef.current('auto')) break;
      steps += 1;
    }
  }, [advanceRef, baseIntervalMs]);

  const advanceExternalClock = useCallback((milliseconds: number) => {
    externalClockUntilRef.current = performance.now() + 1_000;
    driveClock(Math.max(0, milliseconds));
  }, [driveClock]);

  useEffect(() => {
    let animationFrame = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(250, Math.max(0, now - lastTime));
      lastTime = now;
      if (now >= externalClockUntilRef.current) driveClock(elapsed);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [driveClock]);

  return { running, speed, pause, toggle, changeSpeed, advanceExternalClock };
}
