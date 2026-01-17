"use client";

import { useEffect } from "react";
import { startSessionTracking } from "@/lib/trackActivity";

export function ActivityTracker() {
  useEffect(() => {
    return startSessionTracking();
  }, []);

  return null;
}
