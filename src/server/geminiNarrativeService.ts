import { GoogleGenAI } from "@google/genai";

export type SubjectType = "self" | "opponent";

export type NarrativeResult = {
  quick_summary: string;
  comprehensive_report: string;
  generated_at: string;
  subject_type: SubjectType;
  model_used: string;
};

type ProfilePayload = {
  analysis_context: {
    subject_type: SubjectType;
  };
  opponent_profile: any;
  style_markers: any[];
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use the model name without 'models/' prefix for the new SDK
const GEMINI_MODEL = process.env.GEMINI_TUNED_MODEL || "gemini-2.0-flash-exp";

const SYSTEM_INSTRUCTION = `Role

You are ChessScout CoachGPT, a professional chess coach and analyst.
You receive a structured JSON profile describing a chess player's historical games, openings, repertoire, style metrics, and results.

Your task is to produce a coach-quality analysis derived strictly from the JSON.

1. Input Assumptions

You will receive:

A single JSON object matching the ChessScout opponent profile schema

The JSON may describe:

The user themself, or

Another player the user wants to analyze (an opponent)

You must infer which case applies using:

analysis_context.subject_type (if provided), OR

a flag provided externally (e.g. mode = "self" vs "opponent")

If no explicit flag is provided:

Assume opponent analysis by default

2. Narrative Rules (CRITICAL)
A. Voice & Perspective
If analyzing the user themself:

Use second person:

"you"

"your games"

"you tend to…"

Tone:

constructive

encouraging

improvement-oriented

Language:

"You may benefit from…"

"A natural next step would be…"

"This suggests an opportunity to improve…"

If analyzing another player:

Use third person, referring to:

the player's username

Tone:

neutral, tactical, scouting-oriented

Language:

"This player tends to…"

"You may want to be careful of…"

"You might take advantage of…"

"Against this player…"

Never mix perspectives in the same report.

3. Output Requirements (MANDATORY)

You must produce two versions, clearly separated:

1️⃣ Quick Summary (ONE paragraph)

Single paragraph

5–7 sentences max

Covers:

Overall style

Opening tendencies

One key strength

One key weakness or exploitable pattern

Written in the correct narrative voice (self vs opponent)

2️⃣ Comprehensive Report

Full coach-style analysis

Structured, readable, professional

No fluff, no repetition

Based only on JSON-supported facts

4. Required Report Structure (Comprehensive Version)

You must follow this structure exactly:

1. Snapshot

Player name / platform

Ratings (if present)

Games analyzed

Date range

Dominant time control

Filters used

2. Results & Competitive Profile

Overall W/D/L %

Performance as White vs Black

Brief interpretation:

risk profile

draw tendency (high / moderate / low)

3. Opening & Repertoire Tendencies

As White: top openings

As Black vs 1.e4:

opening choices

predictability of first reply (from repertoire tree)

As Black vs 1.d4:

same

Flag:

highly predictable

moderately varied

varied

4. Style & Structure

Use segments.all.style:

Castling tendencies (explicitly state denominator used)

Average castling timing

Queen trades by move 20

Pawn storms after castling

Aggression signature:

pawns by move 10

captures by move 15

checks by move 15

5. Time Control Shifts

For each available segment (e.g. blitz):

Compare vs segments.all

Only mention differences that are meaningful

If similar, explicitly say "style remains consistent"

6. Coach Interpretation

Synthesize patterns into 3–4 key insights

Tie each insight to:

specific metrics

a chess principle

Use conditional language where appropriate:

"suggests"

"likely"

"may indicate"

7. Recommendations

Narrative must match subject type:

Self-analysis:

Improvement-focused

Encouraging

Actionable

Opponent-analysis:

Exploitation-focused

Tactical advice

Match preparation tips

Each recommendation must include:

Observation (with numbers)

Why it matters

What to do (or what to exploit)

8. Action Plan

Provide:

3 concrete drills

2 repertoire adjustments

1 review habit

Adapt language:

"You should practice…" (self)

"You may want to prepare…" (opponent)

9. Data Gaps & Confidence Notes

Explicitly state what is not measured

Especially if engineInsights is null:

no blunder analysis

no eval swings

no conversion metrics

Flag small sample sizes where relevant

5. Use of Style Markers (style_markers[])

Rules:

Use style markers as labels, not evidence

Cross-check them against raw metrics

If a marker implies something not measured:

Phrase as "may indicate"

Never override numeric stats with marker text

Example:

"The profile tags this player as an Aggressive Attacker. While sacrifice frequency isn't measured directly, the higher-than-average checks and capture rates support a tactical orientation."

6. Guardrails (NON-NEGOTIABLE)

❌ Do not invent data

❌ Do not infer blunders, sacrifices, or accuracy unless explicitly measured

❌ Do not ignore denominators

❌ Do not mix narrative perspectives

❌ Do not assume intent or psychology beyond data

If a stat is ambiguous:

Acknowledge uncertainty

Reduce strength of claims

7. Formatting Rules

Output in markdown

Clear section headers

Bullet points only where helpful

No emojis

No citations

No meta-commentary

8. Final Instruction

Produce:

Quick Summary (1 paragraph)

Comprehensive Report (structured, full)

Use the correct narrative voice and tone based on subject type.`;

function parseNarrativeResponse(text: string): { quick_summary: string; comprehensive_report: string } {
  console.log("[GeminiNarrative] Parsing response, total length:", text.length);
  console.log("[GeminiNarrative] First 500 chars:", text.slice(0, 500));
  
  let quick_summary = "";
  let comprehensive_report = "";

  // Strategy 1: Look for explicit section markers with various formats
  // The AI might output: "## Quick Summary", "# Quick Summary", "**Quick Summary**", "Quick Summary:", etc.
  const quickSummaryPatterns = [
    /#{1,3}\s*Quick Summary\s*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/i,
    /\*\*Quick Summary\*\*\s*\n+([\s\S]*?)(?=\n\*\*|$)/i,
    /Quick Summary:?\s*\n+([\s\S]*?)(?=\n#{1,3}\s|\nComprehensive|\n\*\*Comprehensive|$)/i,
  ];

  const comprehensivePatterns = [
    /#{1,3}\s*Comprehensive Report\s*\n+([\s\S]*?)$/i,
    /\*\*Comprehensive Report\*\*\s*\n+([\s\S]*?)$/i,
    /Comprehensive Report:?\s*\n+([\s\S]*?)$/i,
  ];

  // Try to find Quick Summary
  for (const pattern of quickSummaryPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      quick_summary = match[1].trim();
      console.log("[GeminiNarrative] Found quick summary with pattern, length:", quick_summary.length);
      break;
    }
  }

  // Try to find Comprehensive Report
  for (const pattern of comprehensivePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      comprehensive_report = match[1].trim();
      console.log("[GeminiNarrative] Found comprehensive report with pattern, length:", comprehensive_report.length);
      break;
    }
  }

  // Strategy 2: If we found comprehensive but not quick, extract quick from before comprehensive header
  if (!quick_summary && comprehensive_report) {
    const comprehensiveIndex = text.search(/#{1,3}\s*Comprehensive Report|\*\*Comprehensive Report\*\*|Comprehensive Report:/i);
    if (comprehensiveIndex > 0) {
      const beforeComprehensive = text.slice(0, comprehensiveIndex);
      // Remove any Quick Summary header
      quick_summary = beforeComprehensive
        .replace(/^#{1,3}\s*Quick Summary\s*\n*/i, "")
        .replace(/^\*\*Quick Summary\*\*\s*\n*/i, "")
        .replace(/^Quick Summary:?\s*\n*/i, "")
        .trim();
      console.log("[GeminiNarrative] Extracted quick summary from before comprehensive, length:", quick_summary.length);
    }
  }

  // Strategy 3: If still no sections found, try splitting by first major heading after intro
  if (!quick_summary && !comprehensive_report) {
    console.log("[GeminiNarrative] No sections found, trying fallback split");
    // Look for the first ## or # heading that isn't Quick Summary
    const firstHeadingMatch = text.match(/\n(#{1,2})\s+(?!Quick Summary)([^\n]+)/i);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
      quick_summary = text.slice(0, firstHeadingMatch.index).trim();
      comprehensive_report = text.slice(firstHeadingMatch.index).trim();
    } else {
      // Final fallback: first paragraph is quick, rest is comprehensive
      const firstDoubleNewline = text.indexOf("\n\n");
      if (firstDoubleNewline > 0) {
        quick_summary = text.slice(0, firstDoubleNewline).trim();
        comprehensive_report = text.slice(firstDoubleNewline + 2).trim();
      } else {
        quick_summary = text.trim();
        comprehensive_report = text.trim();
      }
    }
  }

  // Clean up: remove the header from quick_summary if it starts with one
  quick_summary = quick_summary
    .replace(/^#{1,3}\s*Quick Summary\s*\n*/i, "")
    .replace(/^\*\*Quick Summary\*\*\s*\n*/i, "")
    .trim();

  console.log("[GeminiNarrative] Final quick_summary length:", quick_summary.length);
  console.log("[GeminiNarrative] Final comprehensive_report length:", comprehensive_report.length);
  console.log("[GeminiNarrative] Quick summary preview:", quick_summary.slice(0, 200));

  return { quick_summary, comprehensive_report };
}

export async function generateNarrative(params: {
  profileJson: any;
  styleMarkers: any[];
  subjectType: SubjectType;
  username: string;
  platform: string;
}): Promise<NarrativeResult> {
  console.log("[GeminiNarrative] Starting generation for", params.username, "with model:", GEMINI_MODEL);
  
  if (!GEMINI_API_KEY) {
    console.error("[GeminiNarrative] GEMINI_API_KEY environment variable is not set");
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  console.log("[GeminiNarrative] API key found, initializing Gemini AI with new SDK");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const payload: ProfilePayload = {
    analysis_context: {
      subject_type: params.subjectType,
    },
    opponent_profile: {
      username: params.username,
      platform: params.platform,
      ...params.profileJson,
    },
    style_markers: params.styleMarkers,
  };

  try {
    console.log("[GeminiNarrative] Calling generateContent with model:", GEMINI_MODEL);
    
    const config: any = {
      model: GEMINI_MODEL,
    };
    
    // Add system instruction if not using a tuned model
    if (!GEMINI_MODEL.startsWith("tunedModels/")) {
      config.systemInstruction = [{ text: SYSTEM_INSTRUCTION }];
    }
    
    const response = await ai.models.generateContent({
      ...config,
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    });

    const text = response.text ?? "";
    console.log("[GeminiNarrative] Got response, length:", text.length);

    const { quick_summary, comprehensive_report } = parseNarrativeResponse(text);

    return {
      quick_summary,
      comprehensive_report,
      generated_at: new Date().toISOString(),
      subject_type: params.subjectType,
      model_used: GEMINI_MODEL,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GeminiNarrative] Generation failed:", message);
    throw new Error(`Narrative generation failed: ${message}`);
  }
}

export async function generateNarrativeWithRetry(params: {
  profileJson: any;
  styleMarkers: any[];
  subjectType: SubjectType;
  username: string;
  platform: string;
  maxRetries?: number;
}): Promise<NarrativeResult> {
  const maxRetries = params.maxRetries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await generateNarrative(params);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[GeminiNarrative] Attempt ${attempt + 1} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError ?? new Error("Narrative generation failed after retries");
}
