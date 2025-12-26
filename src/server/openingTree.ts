import { Chess } from "chess.js";
import { normalizeFen, type LichessSpeed } from "@/server/opponentModel";

type ChessPlatform = "lichess" | "chesscom";

export type OpponentMoveEventRow = {
  profile_id: string;
  platform: ChessPlatform;
  username: string;
  platform_game_id: string;
  played_at: string | null;
  speed: LichessSpeed | null;
  rated: boolean | null;
  fen: string;
  uci: string;
  san: string | null;
  ply: number;
  is_opponent_move: boolean;
  win: number;
  loss: number;
  draw: number;
};

function getPgnTagValue(pgn: string, tag: string): string | null {
  const re = new RegExp(`^\\[${tag}\\s+\\"([^\\"]*)\\"\\]$`, "mi");
  const m = pgn.match(re);
  const raw = (m?.[1] ?? "").trim();
  return raw ? raw : null;
}

function inferOpponentColorFromPgn(pgn: string, opponentUsername: string): "w" | "b" | null {
  const re = /^\[(White|Black)\s+\"([^\"]+)\"\]$/gm;
  const opp = opponentUsername.trim().toLowerCase();

  let match: RegExpExecArray | null;
  let white: string | null = null;
  let black: string | null = null;

  while ((match = re.exec(pgn)) !== null) {
    const side = match[1];
    const name = (match[2] ?? "").trim();
    if (!name) continue;
    if (side === "White") white = name;
    if (side === "Black") black = name;
  }

  if (white?.trim().toLowerCase() === opp) return "w";
  if (black?.trim().toLowerCase() === opp) return "b";
  return null;
}

function inferResultFromPgn(pgn: string): "1-0" | "0-1" | "1/2-1/2" | "*" {
  const m = pgn.match(/^\[Result\s+\"(1-0|0-1|1\/2-1\/2|\*)\"\]$/m);
  return (m?.[1] as any) ?? "*";
}

function inferSpeedFromPgn(pgn: string): LichessSpeed | null {
  const speedTag = getPgnTagValue(pgn, "Speed");
  if (speedTag) {
    const s = speedTag.trim().toLowerCase();
    if (["bullet", "blitz", "rapid", "classical", "correspondence"].includes(s)) return s as LichessSpeed;
  }

  const event = (getPgnTagValue(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("bullet")) return "bullet";
  if (event.includes("blitz")) return "blitz";
  if (event.includes("rapid")) return "rapid";
  if (event.includes("classical")) return "classical";
  if (event.includes("correspondence")) return "correspondence";
  return null;
}

function inferRatedFromPgn(pgn: string): boolean | null {
  const ratedTag = getPgnTagValue(pgn, "Rated");
  if (ratedTag) {
    const v = ratedTag.trim().toLowerCase();
    if (["true", "yes", "1"].includes(v)) return true;
    if (["false", "no", "0"].includes(v)) return false;
  }

  const event = (getPgnTagValue(pgn, "Event") ?? "").toLowerCase();
  if (event.includes("rated")) return true;
  if (event.includes("casual")) return false;
  return null;
}

function inferOutcomeFlags(params: { oppColor: "w" | "b"; result: string }): { win: number; loss: number; draw: number } {
  const { oppColor, result } = params;
  if (result === "1/2-1/2") return { win: 0, loss: 0, draw: 1 };
  if (result === "1-0") return oppColor === "w" ? { win: 1, loss: 0, draw: 0 } : { win: 0, loss: 1, draw: 0 };
  if (result === "0-1") return oppColor === "b" ? { win: 1, loss: 0, draw: 0 } : { win: 0, loss: 1, draw: 0 };
  return { win: 0, loss: 0, draw: 0 };
}

export function buildOpponentMoveEventsFromGame(params: {
  profileId: string;
  platform: ChessPlatform;
  username: string;
  platformGameId: string;
  playedAt: string | null;
  pgn: string;
}): OpponentMoveEventRow[] {
  const { profileId, platform, username, platformGameId, playedAt, pgn } = params;

  const oppColor = inferOpponentColorFromPgn(pgn, username);
  if (!oppColor) return [];

  const result = inferResultFromPgn(pgn);
  const outcome = inferOutcomeFlags({ oppColor, result });
  const speed = inferSpeedFromPgn(pgn);
  const rated = inferRatedFromPgn(pgn);

  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    return [];
  }

  const verbose = chess.history({ verbose: true }) as any[];
  const replay = new Chess();
  const out: OpponentMoveEventRow[] = [];

  let ply = 0;
  for (const mv of verbose) {
    const fenKey = normalizeFen(replay.fen());

    let played: any = null;
    try {
      played = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      break;
    }
    if (!played) break;

    ply += 1;
    const uci = `${mv.from}${mv.to}${mv.promotion ? mv.promotion : ""}`;
    const moveColor = mv?.color as "w" | "b" | undefined;

    out.push({
      profile_id: profileId,
      platform,
      username,
      platform_game_id: platformGameId,
      played_at: playedAt,
      speed,
      rated,
      fen: fenKey,
      uci,
      san: (mv?.san as string | null) ?? null,
      ply,
      is_opponent_move: moveColor === oppColor,
      win: outcome.win,
      loss: outcome.loss,
      draw: outcome.draw,
    });
  }

  return out;
}

export async function upsertOpponentMoveEvents(params: {
  supabase: any;
  rows: OpponentMoveEventRow[];
}) {
  const { supabase, rows } = params;
  if (rows.length === 0) return { inserted: 0 };

  // Supabase upsert payload size can get large; chunk.
  const chunkSize = 1000;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, data } = await supabase
      .from("opponent_move_events")
      .upsert(chunk, {
        onConflict: "profile_id,platform,platform_game_id,ply",
        ignoreDuplicates: true,
      })
      .select("profile_id");

    if (error) throw error;
    inserted += (data?.length ?? 0);
  }

  return { inserted };
}
