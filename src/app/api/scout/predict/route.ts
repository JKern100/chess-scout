import { NextRequest, NextResponse } from "next/server";
import { Chess } from "chess.js";

const SCOUT_API_URL = process.env.SCOUT_API_URL || "http://localhost:8001";

/**
 * POST /api/scout/predict
 * 
 * Proxy to the Python Scout API for move prediction.
 * This allows the frontend to call the Scout API without CORS issues
 * and enables server-side authentication/rate limiting if needed.
 */
export async function POST(req: NextRequest) {
  // In production we require a non-localhost SCOUT_API_URL.
  // In local dev we allow the default localhost URL so Scout Insights works.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && (!process.env.SCOUT_API_URL || process.env.SCOUT_API_URL.includes("localhost"))) {
    return NextResponse.json(
      { error: "Scout API not configured on this server" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();

    try {
      const fen = typeof body?.fen === "string" ? String(body.fen) : "";
      if (fen) {
        const chess = new Chess(fen);
        if (chess.isGameOver()) {
          const outcome = chess.isCheckmate()
            ? "Checkmate"
            : chess.isStalemate()
              ? "Stalemate"
              : chess.isThreefoldRepetition()
                ? "Threefold repetition"
                : chess.isInsufficientMaterial()
                  ? "Insufficient material"
                  : chess.isDraw()
                    ? "Draw"
                    : "Game over";

          const mode = body?.mode === "pure_history" ? "pure_history" : "hybrid";
          return NextResponse.json({
            prediction_mode: mode,
            selected_move: "",
            selected_move_uci: "",
            weights: {
              phase: "terminal",
              history: 0,
              engine: 0,
              style: 0,
            },
            candidates: [],
            trace_log: [{ type: "warning", message: outcome }],
            tilt_active: false,
            blunder_applied: false,
            move_source: {
              primary_source: "history",
              history_contribution: 0,
              style_contribution: 0,
              engine_contribution: 0,
            },
            terminal: { is_game_over: true, outcome },
          });
        }
      }
    } catch {
      // ignore fen parse errors
    }

    const res = await fetch(`${SCOUT_API_URL}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const contentType = res.headers.get("content-type") || "";
      const errData = contentType.includes("application/json")
        ? await res.json().catch(() => ({}))
        : await res.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            typeof errData === "object" && errData
              ? ((errData as any).detail ?? (errData as any).error ?? `Scout API error: ${res.status}`)
              : String(errData || `Scout API error: ${res.status}`),
        },
        { status: res.status }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: text || "Scout API returned a non-JSON response" },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Scout API request timed out" },
        { status: 504 }
      );
    }
    console.error("Scout API proxy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scout API unavailable" },
      { status: 502 }
    );
  }
}
