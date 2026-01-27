import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchLichessGameHeadersSince,
  LichessGameHeader,
} from "@/server/services/lichess";

type ChessPlatform = "lichess" | "chesscom";

export type OpponentSummary = {
  platform: ChessPlatform;
  username: string;
  sinceMs: number | null;
  newGamesCount: number;
  speedCounts: Record<string, number>;
  ratedCount: number;
  casualCount: number;
  variants: Record<string, number>;
  ratingDeltas: Record<string, number>;
  currentRatings: Record<string, number>;
  notes: string[];
  error?: string;
};

const CONCURRENCY_LIMIT = 3;

async function fetchBatchedRatings(
  usernames: string[]
): Promise<Map<string, Record<string, number>>> {
  const ratingsMap = new Map<string, Record<string, number>>();
  if (usernames.length === 0) return ratingsMap;

  const batchSize = 100;
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);

    try {
      const res = await fetch("https://lichess.org/api/users", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "text/plain",
        },
        body: batch.join(","),
        cache: "no-store",
      });

      if (!res.ok) continue;

      const usersData = (await res.json()) as Array<{
        id: string;
        username: string;
        perfs?: Record<string, { rating?: number; games?: number }>;
      }>;

      for (const user of usersData) {
        const ratings: Record<string, number> = {};
        if (user.perfs) {
          for (const [key, perf] of Object.entries(user.perfs)) {
            if (typeof perf.rating === "number") {
              ratings[key] = perf.rating;
            }
          }
        }
        ratingsMap.set(user.id.toLowerCase(), ratings);
      }
    } catch {
      // Continue with partial results
    }
  }

  return ratingsMap;
}

function computeSummaryFromGames(
  games: LichessGameHeader[],
  targetUsername: string,
  previousRatings: Record<string, number> | null,
  currentRatings: Record<string, number>
): Omit<OpponentSummary, "platform" | "username" | "sinceMs" | "error"> {
  const speedCounts: Record<string, number> = {};
  const variants: Record<string, number> = {};
  let ratedCount = 0;
  let casualCount = 0;
  const notes: string[] = [];

  const targetLower = targetUsername.toLowerCase();



  function computeGameBasedRatingDeltas(): Record<string, number> {
    const perSpeed: Record<string, Array<{ ts: number; rating: number }>> = {};

    for (const g of games) {
      const speed = g.speed;
      if (!speed) continue;

      const whiteName = (g.white.username ?? "").toLowerCase();
      const blackName = (g.black.username ?? "").toLowerCase();

      const rating =
        whiteName === targetLower
          ? g.white.rating
          : blackName === targetLower
            ? g.black.rating
            : null;
      if (typeof rating !== "number" || !Number.isFinite(rating)) continue;

      const tsRaw = g.lastMoveAt ?? g.createdAt ?? 0;
      const ts = typeof tsRaw === "number" && Number.isFinite(tsRaw) ? tsRaw : 0;

      (perSpeed[speed] ??= []).push({ ts, rating });
    }

    const out: Record<string, number> = {};
    for (const [speed, entries] of Object.entries(perSpeed)) {
      if (!entries || entries.length === 0) continue;
      const sorted = entries.slice().sort((a, b) => a.ts - b.ts);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) continue;

      const current = currentRatings[speed];
      if (typeof current === "number" && Number.isFinite(current)) {
        out[speed] = Math.trunc(current - first.rating);
      } else {
        out[speed] = Math.trunc(last.rating - first.rating);
      }
    }

    return out;
  }

  for (const g of games) {
    // Count by speed
    if (g.speed) {
      speedCounts[g.speed] = (speedCounts[g.speed] || 0) + 1;
    }

    // Count rated vs casual
    if (g.rated) {
      ratedCount++;
    } else {
      casualCount++;
    }

    // Count non-standard variants
    if (g.variant && g.variant !== "standard") {
      variants[g.variant] = (variants[g.variant] || 0) + 1;
    }
  }

  const ratingDeltas: Record<string, number> = {};
  const gameBasedDeltas = computeGameBasedRatingDeltas();

  if (Object.keys(gameBasedDeltas).length > 0) {
    for (const [speed, delta] of Object.entries(gameBasedDeltas)) {
      ratingDeltas[speed] = delta;
    }
  } else if (previousRatings) {
    for (const [speed, currentRating] of Object.entries(currentRatings)) {
      if (!speedCounts[speed]) continue;
      const prevRating = previousRatings[speed];
      if (typeof prevRating === "number") {
        ratingDeltas[speed] = Math.trunc(currentRating - prevRating);
      }
    }
  }

  // Generate notes
  if (games.length > 0) {
    // Primary speed note
    const sortedSpeeds = Object.entries(speedCounts).sort((a, b) => b[1] - a[1]);
    if (sortedSpeeds.length > 0) {
      const [topSpeed, topCount] = sortedSpeeds[0];
      const pct = Math.round((topCount / games.length) * 100);
      if (pct >= 50) {
        if (pct === 100) {
          notes.push(`All ${topSpeed} (${pct}%)`);
        } else {
          notes.push(`Mostly ${topSpeed} (${pct}%)`);
        }
      }
      if (Object.keys(ratingDeltas).length === 0) {
        ratingDeltas[topSpeed] = 0;
      }
    }

    // Variant note
    const variantEntries = Object.entries(variants);
    if (variantEntries.length > 0) {
      const variantNames = variantEntries.map(([v]) => v).join(", ");
      notes.push(`Tried ${variantNames}`);
    }
  }

  return {
    newGamesCount: games.length,
    speedCounts,
    ratedCount,
    casualCount,
    variants,
    ratingDeltas,
    currentRatings,
    notes,
  };
}

async function fetchExistingPlatformGameIds(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  platform: ChessPlatform;
  username: string;
  platformGameIds: string[];
}): Promise<Set<string>> {
  const { supabase, userId, platform, username, platformGameIds } = params;

  if (platformGameIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("games")
    .select("platform_game_id")
    .eq("profile_id", userId)
    .eq("platform", platform)
    .ilike("username", username.toLowerCase())
    .in("platform_game_id", platformGameIds);

  if (error || !data) return new Set();
  return new Set(
    data
      .map((r: any) => String(r?.platform_game_id ?? "").trim())
      .filter((v: string) => v.length > 0)
  );
}

async function fetchLatestSyncedPlayedAtMs(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  platform: ChessPlatform;
  username: string;
}): Promise<number | null> {
  const { supabase, userId, platform, username } = params;

  const { data, error } = await supabase
    .from("games")
    .select("played_at")
    .eq("profile_id", userId)
    .eq("platform", platform)
    .ilike("username", username.toLowerCase())
    .not("played_at", "is", null)
    .order("played_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const iso = (data as any)?.played_at as string | null | undefined;
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms > Date.now() + 5 * 60 * 1000) return null;
  return ms;
}

async function processOpponent(
  opponent: {
    platform: ChessPlatform;
    username: string;
    created_at: string;
    last_refreshed_at: string | null;
    last_known_ratings: Record<string, number> | null;
  },
  currentRatings: Record<string, number>,
  ctx: {
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    userId: string;
  }
): Promise<OpponentSummary> {
  const { platform, username, created_at, last_refreshed_at, last_known_ratings } = opponent;

  const latestSyncedMs = await fetchLatestSyncedPlayedAtMs({
    supabase: ctx.supabase,
    userId: ctx.userId,
    platform,
    username,
  });

  const fallbackIso = last_refreshed_at ?? created_at;
  const fallbackMs = new Date(fallbackIso).getTime();
  const baseMs = latestSyncedMs ?? (Number.isFinite(fallbackMs) ? fallbackMs : Date.now());
  const sinceMs = Math.max(0, baseMs - 48 * 60 * 60 * 1000);

  try {
    if (platform !== "lichess") {
      return {
        platform,
        username,
        sinceMs,
        newGamesCount: 0,
        speedCounts: {},
        ratedCount: 0,
        casualCount: 0,
        variants: {},
        ratingDeltas: {},
        currentRatings,
        notes: [],
        error: "Only Lichess is supported for quick refresh",
      };
    }

    const result = await fetchLichessGameHeadersSince({
      username,
      sinceMs,
      max: 500,
    });

    const platformGameIds = result.games.map((g) => g.id);
    const existingIds = await fetchExistingPlatformGameIds({
      supabase: ctx.supabase,
      userId: ctx.userId,
      platform,
      username,
      platformGameIds,
    });

    const unsyncedGames = result.games.filter((g) => !existingIds.has(g.id));

    // Debug logging for troubleshooting
    if (username.toLowerCase() === "fernandoracing") {
      console.log(`[quick-refresh] fernandoracing debug:`, {
        latestSyncedMs,
        sinceMs,
        sinceMsDate: new Date(sinceMs).toISOString(),
        totalGamesFromLichess: result.games.length,
        existingIdsCount: existingIds.size,
        unsyncedCount: unsyncedGames.length,
        sampleGameIds: platformGameIds.slice(0, 5),
        sampleExistingIds: Array.from(existingIds).slice(0, 5),
      });
    }

    const summary = computeSummaryFromGames(
      unsyncedGames,
      username,
      last_known_ratings,
      currentRatings
    );

    return {
      platform,
      username,
      sinceMs,
      ...summary,
    };
  } catch (err) {
    return {
      platform,
      username,
      sinceMs,
      newGamesCount: 0,
      speedCounts: {},
      ratedCount: 0,
      casualCount: 0,
      variants: {},
      ratingDeltas: {},
      currentRatings,
      notes: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch all non-archived opponents
    const { data: opponents, error: opponentsError } = await supabase
      .from("opponents")
      .select("platform, username, created_at, last_refreshed_at, last_known_ratings")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (opponentsError) {
      return NextResponse.json(
        { error: opponentsError.message, where: "select opponents" },
        { status: 500 }
      );
    }

    if (!opponents || opponents.length === 0) {
      return NextResponse.json({ summaries: [] });
    }

    // Fetch current ratings for all opponents in batch
    const lichessUsernames = opponents
      .filter((o) => o.platform === "lichess")
      .map((o) => o.username);

    const currentRatingsMap = await fetchBatchedRatings(lichessUsernames);

    // Process opponents with concurrency limit
    const summaries = await runWithConcurrency(
      opponents,
      CONCURRENCY_LIMIT,
      async (opponent) => {
        const currentRatings = currentRatingsMap.get(opponent.username.toLowerCase()) || {};
        return processOpponent(
          opponent as {
            platform: ChessPlatform;
            username: string;
            created_at: string;
            last_refreshed_at: string | null;
            last_known_ratings: Record<string, number> | null;
          },
          currentRatings,
          { supabase, userId: user.id }
        );
      }
    );

    // Update database with new timestamps and ratings
    const now = new Date().toISOString();
    const updates = opponents.map((opponent) => {
      const currentRatings = currentRatingsMap.get(opponent.username.toLowerCase()) || null;
      return supabase
        .from("opponents")
        .update({
          last_quick_refreshed_at: now,
          last_known_ratings: currentRatings,
          last_known_ratings_at: currentRatings ? now : null,
        })
        .eq("user_id", user.id)
        .eq("platform", opponent.platform)
        .eq("username", opponent.username);
    });

    const updateResults = await Promise.all(updates);
    const firstUpdateError = updateResults.find((r) => r.error)?.error;
    if (firstUpdateError) {
      return NextResponse.json(
        { error: firstUpdateError.message, where: "update opponents" },
        { status: 500 }
      );
    }

    return NextResponse.json({ summaries });
  } catch (err) {
    console.error("Quick refresh unhandled error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        where: "unhandled",
      },
      { status: 500 }
    );
  }
}
