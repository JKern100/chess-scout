import { NextRequest, NextResponse } from "next/server";

const SCOUT_API_URL = process.env.SCOUT_API_URL || "http://localhost:8001";

/**
 * POST /api/scout/predict
 * 
 * Proxy to the Python Scout API for move prediction.
 * This allows the frontend to call the Scout API without CORS issues
 * and enables server-side authentication/rate limiting if needed.
 */
export async function POST(req: NextRequest) {
  // Check if Scout API is configured
  if (!process.env.SCOUT_API_URL || process.env.SCOUT_API_URL.includes("localhost")) {
    return NextResponse.json(
      { error: "Scout API not configured on this server" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();

    const res = await fetch(`${SCOUT_API_URL}/predict`, {
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
    console.error("Scout API proxy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scout API unavailable" },
      { status: 502 }
    );
  }
}
