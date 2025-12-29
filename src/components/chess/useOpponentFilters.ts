"use client";

import { useEffect, useMemo, useState } from "react";

export type OpponentSpeed = "bullet" | "blitz" | "rapid" | "classical" | "correspondence";
export type OpponentRatedFilter = "any" | "rated" | "casual";

export type DatePreset = "7d" | "30d" | "6m" | "18m" | "all" | "custom";

const DEFAULT_SPEEDS: OpponentSpeed[] = ["bullet", "blitz", "rapid", "classical", "correspondence"];
const STORAGE_KEY = "chessscout.opponentFilters";

function formatDateInput(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getDateRangeFromPreset(preset: DatePreset, now: Date) {
  if (preset === "all") return { from: "", to: "" };
  if (preset === "custom") return { from: null as string | null, to: null as string | null };

  const end = new Date(now);
  const start = new Date(now);
  if (preset === "7d") start.setDate(start.getDate() - 7);
  else if (preset === "30d") start.setDate(start.getDate() - 30);
  else if (preset === "6m") start.setMonth(start.getMonth() - 6);
  else if (preset === "18m") start.setMonth(start.getMonth() - 18);
  return { from: formatDateInput(start), to: formatDateInput(end) };
}

export function useOpponentFilters() {
  const [speeds, setSpeeds] = useState<OpponentSpeed[]>(DEFAULT_SPEEDS);
  const [rated, setRated] = useState<OpponentRatedFilter>("any");
  const [datePreset, setDatePreset] = useState<DatePreset>("6m");
  const [fromDate, setFromDate] = useState<string>(() => getDateRangeFromPreset("6m", new Date()).from ?? "");
  const [toDate, setToDate] = useState<string>(() => getDateRangeFromPreset("6m", new Date()).to ?? "");

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

      const storedFrom = typeof parsed?.from === "string" ? parsed.from : "";
      const storedTo = typeof parsed?.to === "string" ? parsed.to : "";

      const rawPreset = String(parsed?.datePreset ?? "");
      const preset =
        rawPreset === "7d" ||
        rawPreset === "30d" ||
        rawPreset === "6m" ||
        rawPreset === "18m" ||
        rawPreset === "all" ||
        rawPreset === "custom"
          ? (rawPreset as DatePreset)
          : null;

      if (preset) {
        setDatePreset(preset);
        if (preset === "custom") {
          setFromDate(storedFrom);
          setToDate(storedTo);
        } else {
          const next = getDateRangeFromPreset(preset, new Date());
          setFromDate(next.from ?? "");
          setToDate(next.to ?? "");
        }
      } else {
        // Back-compat: if previous sessions stored custom dates, honor them.
        if (storedFrom || storedTo) {
          setDatePreset("custom");
          setFromDate(storedFrom);
          setToDate(storedTo);
        } else {
          setDatePreset("6m");
          const next = getDateRangeFromPreset("6m", new Date());
          setFromDate(next.from ?? "");
          setToDate(next.to ?? "");
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ speeds, rated, datePreset, from: fromDate, to: toDate })
      );
    } catch {
      // ignore
    }
  }, [datePreset, speeds, rated, fromDate, toDate]);

  const filtersKey = useMemo(() => {
    const speedsKey = [...speeds].sort().join(",");
    return `${speedsKey}|${rated}|${fromDate}|${toDate}`;
  }, [speeds, rated, fromDate, toDate]);

  function setPreset(next: DatePreset) {
    setDatePreset(next);
    const computed = getDateRangeFromPreset(next, new Date());
    if (computed.from != null) setFromDate(computed.from);
    if (computed.to != null) setToDate(computed.to);
  }

  function setFromDateManual(v: string) {
    setDatePreset("custom");
    setFromDate(v);
  }

  function setToDateManual(v: string) {
    setDatePreset("custom");
    setToDate(v);
  }

  return {
    speeds,
    setSpeeds,
    rated,
    setRated,
    datePreset,
    setDatePreset: setPreset,
    fromDate,
    setFromDate: setFromDateManual,
    toDate,
    setToDate: setToDateManual,
    filtersKey,
  };
}
