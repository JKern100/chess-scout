"use client";

import { useCallback, useEffect, useRef } from "react";

export function useChessSounds(soundEnabled: boolean) {
  const moveRef = useRef<HTMLAudioElement | null>(null);
  const captureRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Lazily create audio elements once per mount.
    if (!moveRef.current) {
      moveRef.current = new Audio("/sounds/move.mp3");
      moveRef.current.preload = "auto";
    }
    if (!captureRef.current) {
      captureRef.current = new Audio("/sounds/capture.mp3");
      captureRef.current.preload = "auto";
    }
  }, []);

  const playMoveSound = useCallback(
    (isCapture: boolean) => {
      if (!soundEnabled) return;
      if (typeof window === "undefined") return;

      const el = (isCapture ? captureRef.current : moveRef.current) ?? null;
      if (!el) return;

      try {
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof (p as any).catch === "function") {
          (p as Promise<void>).catch(() => {
            // Ignore autoplay / gesture restrictions.
          });
        }
      } catch {
        // ignore
      }
    },
    [soundEnabled]
  );

  return { playMoveSound };
}
