import { NextRequest, NextResponse } from "next/server";

const SCOUT_API_URL = process.env.SCOUT_API_URL || "http://localhost:8001";

/**
 * POST /api/scout/analyze
 * 
 * Analyze moves with style-adjusted evaluations.
 * Returns engine evaluations + style impact for each move.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${SCOUT_API_URL}/analyze_moves`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.detail || `Scout API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Scout analyze API proxy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scout API unavailable" },
      { status: 502 }
    );
  }
}
