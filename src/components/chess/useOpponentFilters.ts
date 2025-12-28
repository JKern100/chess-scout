"use client";

import { useEffect, useMemo, useState } from "react";

export type OpponentSpeed = "bullet" | "blitz" | "rapid" | "classical" | "correspondence";
export type OpponentRatedFilter = "any" | "rated" | "casual";

const DEFAULT_SPEEDS: OpponentSpeed[] = ["bullet", "blitz", "rapid", "classical", "correspondence"];
const STORAGE_KEY = "chessscout.opponentFilters";

export function useOpponentFilters() {
  const [speeds, setSpeeds] = useState<OpponentSpeed[]>(DEFAULT_SPEEDS);
  const [rated, setRated] = useState<OpponentRatedFilter>("any");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
      if (!raw) return;
      const parsed = JSON.parse(raw) as any;

      const rawSpeeds = Array.isArray(parsed?.speeds) ? (parsed.speeds as any[]) : [];
      const nextSpeeds = rawSpeeds
        .map((s) => String(s))
        .filter((s) => ["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) as OpponentSpeed[];

      setSpeeds(nextSpeeds.length > 0 ? nextSpeeds : DEFAULT_SPEEDS);

      const rawRated = String(parsed?.rated ?? "any");
      setRated(rawRated === "rated" ? "rated" : rawRated === "casual" ? "casual" : "any");

      setFromDate(typeof parsed?.from === "string" ? parsed.from : "");
      setToDate(typeof parsed?.to === "string" ? parsed.to : "");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ speeds, rated, from: fromDate, to: toDate })
      );
    } catch {
      // ignore
    }
  }, [speeds, rated, fromDate, toDate]);

  const filtersKey = useMemo(() => {
    const speedsKey = [...speeds].sort().join(",");
    return `${speedsKey}|${rated}|${fromDate}|${toDate}`;
  }, [speeds, rated, fromDate, toDate]);

  return {
    speeds,
    setSpeeds,
    rated,
    setRated,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    filtersKey,
  };
}
