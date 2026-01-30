"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type TourPage = "dashboard" | "analysis" | "scoutReport";

type TourState = {
  completedTours: Set<TourPage>;
  activeTour: TourPage | null;
  tourRunning: boolean;
};

type TourContextValue = {
  hasCompletedTour: (page: TourPage) => boolean;
  startTour: (page: TourPage) => void;
  endTour: (page: TourPage, markComplete?: boolean) => void;
  resetTour: (page: TourPage) => void;
  resetAllTours: () => void;
  activeTour: TourPage | null;
  tourRunning: boolean;
  shouldAutoStartTour: (page: TourPage) => boolean;
};

const TourContext = createContext<TourContextValue | null>(null);

const STORAGE_KEY = "chessscout.completedTours";

function loadCompletedTours(): Set<TourPage> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set(parsed as TourPage[]);
      }
    }
  } catch {
    // Ignore errors
  }
  return new Set();
}

function saveCompletedTours(tours: Set<TourPage>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(tours)));
  } catch {
    // Ignore errors
  }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TourState>({
    completedTours: new Set(),
    activeTour: null,
    tourRunning: false,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setState((prev) => ({
      ...prev,
      completedTours: loadCompletedTours(),
    }));
  }, []);

  const hasCompletedTour = useCallback(
    (page: TourPage) => {
      return state.completedTours.has(page);
    },
    [state.completedTours]
  );

  const shouldAutoStartTour = useCallback(
    (page: TourPage) => {
      if (!mounted) return false;
      return !state.completedTours.has(page);
    },
    [mounted, state.completedTours]
  );

  const startTour = useCallback((page: TourPage) => {
    setState((prev) => ({
      ...prev,
      activeTour: page,
      tourRunning: true,
    }));
  }, []);

  const endTour = useCallback((page: TourPage, markComplete = true) => {
    setState((prev) => {
      const newCompletedTours = new Set(prev.completedTours);
      if (markComplete) {
        newCompletedTours.add(page);
        saveCompletedTours(newCompletedTours);
      }
      return {
        ...prev,
        activeTour: null,
        tourRunning: false,
        completedTours: newCompletedTours,
      };
    });
  }, []);

  const resetTour = useCallback((page: TourPage) => {
    setState((prev) => {
      const newCompletedTours = new Set(prev.completedTours);
      newCompletedTours.delete(page);
      saveCompletedTours(newCompletedTours);
      return {
        ...prev,
        completedTours: newCompletedTours,
      };
    });
  }, []);

  const resetAllTours = useCallback(() => {
    setState((prev) => {
      const newCompletedTours = new Set<TourPage>();
      saveCompletedTours(newCompletedTours);
      return {
        ...prev,
        completedTours: newCompletedTours,
      };
    });
  }, []);

  return (
    <TourContext.Provider
      value={{
        hasCompletedTour,
        startTour,
        endTour,
        resetTour,
        resetAllTours,
        activeTour: state.activeTour,
        tourRunning: state.tourRunning,
        shouldAutoStartTour,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return ctx;
}

export type { TourPage };
