"use client";

import { useState, useCallback } from "react";
import { X, Sparkles, Search, ChevronRight, Loader2 } from "lucide-react";
import { Chess } from "chess.js";
import { 
  SYNTHETIC_STYLE_PRESETS, 
  RATING_TIERS,
  type SyntheticStylePreset,
  type RatingTier,
} from "@/config/syntheticStylePresets";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (opponent: any) => void;
};

type OpeningOption = {
  eco: string;
  name: string;
  fen: string;
  movesSan: string[];
};

const POPULAR_OPENINGS: OpeningOption[] = [
  { eco: "B90", name: "Sicilian Najdorf", fen: "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6", movesSan: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"] },
  { eco: "C65", name: "Ruy Lopez Berlin", fen: "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", movesSan: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"] },
  { eco: "D37", name: "Queen's Gambit Declined", fen: "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4", movesSan: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"] },
  { eco: "E60", name: "King's Indian Defense", fen: "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3", movesSan: ["d4", "Nf6", "c4", "g6"] },
  { eco: "B20", name: "Sicilian Defense", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2", movesSan: ["e4", "c5"] },
  { eco: "C50", name: "Italian Game", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", movesSan: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
  { eco: "D06", name: "Queen's Gambit", fen: "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2", movesSan: ["d4", "d5", "c4"] },
  { eco: "A45", name: "Trompowsky Attack", fen: "rnbqkb1r/pppppppp/5n2/6B1/3P4/8/PPP1PPPP/RN1QKBNR b KQkq - 2 2", movesSan: ["d4", "Nf6", "Bg5"] },
  { eco: "B01", name: "Scandinavian Defense", fen: "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", movesSan: ["e4", "d5"] },
  { eco: "C00", name: "French Defense", fen: "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", movesSan: ["e4", "e6"] },
  { eco: "B10", name: "Caro-Kann Defense", fen: "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", movesSan: ["e4", "c6"] },
  { eco: "A80", name: "Dutch Defense", fen: "rnbqkbnr/ppppp1pp/8/5p2/3P4/8/PPP1PPPP/RNBQKBNR w KQkq f6 0 2", movesSan: ["d4", "f5"] },
];

export function CreateSyntheticOpponentModal({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<"style" | "opening" | "rating" | "confirm">("style");
  const [stylePreset, setStylePreset] = useState<SyntheticStylePreset | null>(null);
  const [selectedOpening, setSelectedOpening] = useState<OpeningOption | null>(null);
  const [ratingTier, setRatingTier] = useState<RatingTier>("1800");
  const [customOpeningSearch, setCustomOpeningSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredOpenings = customOpeningSearch
    ? POPULAR_OPENINGS.filter(o => 
        o.name.toLowerCase().includes(customOpeningSearch.toLowerCase()) ||
        o.eco.toLowerCase().includes(customOpeningSearch.toLowerCase())
      )
    : POPULAR_OPENINGS;

  const reset = useCallback(() => {
    setStep("style");
    setStylePreset(null);
    setSelectedOpening(null);
    setRatingTier("1800");
    setCustomOpeningSearch("");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleCreate = useCallback(async () => {
    if (!stylePreset || !selectedOpening) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/synthetic-opponents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stylePreset,
          openingName: selectedOpening.name,
          openingFen: selectedOpening.fen,
          openingEco: selectedOpening.eco,
          openingMovesSan: selectedOpening.movesSan,
          ratingTier,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to create opponent");
      }

      // Start sync immediately
      const syncRes = await fetch(`/api/synthetic-opponents/${json.syntheticOpponent.id}/sync`, {
        method: "POST",
      });

      if (!syncRes.ok) {
        console.warn("Sync failed to start, but opponent was created");
      }

      onCreated(json.syntheticOpponent);
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create opponent");
    } finally {
      setLoading(false);
    }
  }, [stylePreset, selectedOpening, ratingTier, onCreated, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-zinc-900">Create Style-Based Opponent</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3">
          {["style", "opening", "rating", "confirm"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  step === s
                    ? "bg-zinc-900 text-white"
                    : i < ["style", "opening", "rating", "confirm"].indexOf(step)
                      ? "bg-emerald-500 text-white"
                      : "bg-zinc-100 text-zinc-500"
                }`}
              >
                {i + 1}
              </div>
              {i < 3 && <ChevronRight className="h-4 w-4 text-zinc-300" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-5">
          {step === "style" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Choose a Play Style</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Select the style of opponent you want to practice against
                </p>
              </div>
              <div className="grid gap-3">
                {(Object.values(SYNTHETIC_STYLE_PRESETS) as any[]).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setStylePreset(preset.id);
                      setStep("opening");
                    }}
                    className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                      stylePreset === preset.id
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <span className="text-2xl">{preset.icon}</span>
                    <div className="flex-1">
                      <div className="font-medium text-zinc-900">{preset.label}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{preset.shortDescription}</div>
                      <div className="mt-1 text-xs text-zinc-400">{preset.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "opening" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Select Opening</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Choose the opening you want to practice against
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={customOpeningSearch}
                  onChange={(e) => setCustomOpeningSearch(e.target.value)}
                  placeholder="Search openings..."
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-100"
                />
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {filteredOpenings.map((opening) => (
                  <button
                    key={opening.eco}
                    type="button"
                    onClick={() => {
                      setSelectedOpening(opening);
                      setStep("rating");
                    }}
                    className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all ${
                      selectedOpening?.eco === opening.eco
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <div>
                      <div className="font-medium text-zinc-900">{opening.name}</div>
                      <div className="text-xs text-zinc-500">{opening.eco} · {opening.movesSan.join(" ")}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                  </button>
                ))}
                {filteredOpenings.length === 0 && (
                  <div className="py-8 text-center text-sm text-zinc-500">
                    No openings found. Try a different search.
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "rating" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Rating Level</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Choose the skill level of games to learn from
                </p>
              </div>
              <div className="grid gap-3">
                {(Object.entries(RATING_TIERS) as [RatingTier, typeof RATING_TIERS[RatingTier]][]).map(([tier, config]) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => {
                      setRatingTier(tier);
                      setStep("confirm");
                    }}
                    className={`flex items-center justify-between rounded-xl border-2 p-4 text-left transition-all ${
                      ratingTier === tier
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <div>
                      <div className="font-medium text-zinc-900">{config.label}</div>
                      <div className="text-xs text-zinc-500">{config.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "confirm" && stylePreset && selectedOpening && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-900">Confirm Your Opponent</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Review your selections before creating
                </p>
              </div>
              
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{SYNTHETIC_STYLE_PRESETS[stylePreset].icon}</span>
                  <div>
                    <div className="font-semibold text-zinc-900">
                      {selectedOpening.name} / {SYNTHETIC_STYLE_PRESETS[stylePreset].label}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {selectedOpening.eco} · {RATING_TIERS[ratingTier].label}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 rounded-lg bg-white p-3">
                  <div className="text-xs font-medium text-zinc-700">Preparation Tip</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {SYNTHETIC_STYLE_PRESETS[stylePreset].preparationTip}
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Note:</strong> Games will be fetched from Lichess Explorer and scored
                for the selected style. This may take 5-15 seconds.
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-800">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              if (step === "style") handleClose();
              else if (step === "opening") setStep("style");
              else if (step === "rating") setStep("opening");
              else if (step === "confirm") setStep("rating");
            }}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {step === "style" ? "Cancel" : "Back"}
          </button>

          {step === "confirm" && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || !stylePreset || !selectedOpening}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create Opponent
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
