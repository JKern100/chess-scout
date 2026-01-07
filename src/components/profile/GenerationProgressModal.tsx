"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Check, RefreshCw } from "lucide-react";

type Props = {
  isOpen: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  status: "idle" | "generating" | "completed" | "cancelled" | "error";
  errorMessage?: string | null;
  /** Current step being processed (1-8), controlled by parent for real progress */
  currentStepOverride?: number | null;
};

const GENERATION_STEPS = [
  { id: 1, label: "Loading game data" },
  { id: 2, label: "Parsing PGN notation" },
  { id: 3, label: "Classifying openings" },
  { id: 4, label: "Analyzing play style" },
  { id: 5, label: "Computing repertoire patterns" },
  { id: 6, label: "Calculating win/loss statistics" },
  { id: 7, label: "Generating style markers" },
  { id: 8, label: "Finalizing report" },
];

export function GenerationProgressModal({
  isOpen,
  onCancel,
  onDismiss,
  status,
  errorMessage,
  currentStepOverride,
}: Props) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(1);

  // When parent provides currentStepOverride, use it for real progress tracking
  useEffect(() => {
    if (currentStepOverride != null && currentStepOverride > 0) {
      // Mark all steps before current as completed
      const completed = GENERATION_STEPS
        .filter((s) => s.id < currentStepOverride)
        .map((s) => s.id);
      setCompletedSteps(completed);
      setCurrentStep(currentStepOverride);
    }
  }, [currentStepOverride]);

  // Reset when status changes to generating (without override)
  useEffect(() => {
    if (status === "generating" && currentStepOverride == null) {
      setCompletedSteps([]);
      setCurrentStep(1);
    } else if (status === "completed") {
      setCompletedSteps(GENERATION_STEPS.map((s) => s.id));
      setCurrentStep(GENERATION_STEPS.length + 1);
    }
  }, [status, currentStepOverride]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onDismiss();
      }
    },
    [onDismiss]
  );

  if (!isOpen) return null;

  const isGenerating = status === "generating";
  const isCompleted = status === "completed";
  const isCancelled = status === "cancelled";
  const isError = status === "error";

  // Calculate progress percentage
  const progressPct = Math.round((completedSteps.length / GENERATION_STEPS.length) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-100">
              {isGenerating && <RefreshCw className="h-7 w-7 text-yellow-600 animate-spin" />}
              {isCompleted && <Check className="h-7 w-7 text-green-600" />}
              {isCancelled && <X className="h-7 w-7 text-zinc-500" />}
              {isError && <X className="h-7 w-7 text-red-500" />}
            </div>
            <h3 className="text-lg font-semibold text-zinc-900">
              {isGenerating && "Generating Scout Report"}
              {isCompleted && "Report Generated!"}
              {isCancelled && "Generation Cancelled"}
              {isError && "Generation Failed"}
            </h3>
            {isGenerating && (
              <p className="mt-1 text-sm text-zinc-500">
                You can dismiss and continue browsing
              </p>
            )}
          </div>

          {/* Progress bar */}
          {isGenerating && (
            <div className="mb-5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-2 rounded-full bg-yellow-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-2 text-center text-xs text-zinc-500">
                {progressPct}% complete
              </div>
            </div>
          )}

          {/* Checklist */}
          <div className="mb-5 grid gap-1.5">
            {GENERATION_STEPS.map((step) => {
              const isStepCompleted = completedSteps.includes(step.id);
              const isStepCurrent = currentStep === step.id && isGenerating;
              const isStepFailed = isError && currentStep === step.id;

              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-200 ${
                    isStepCompleted
                      ? "bg-green-50"
                      : isStepCurrent
                      ? "bg-yellow-50"
                      : isStepFailed
                      ? "bg-red-50"
                      : "bg-zinc-50"
                  }`}
                >
                  {/* Icon */}
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                      isStepCompleted
                        ? "bg-green-500"
                        : isStepCurrent
                        ? "bg-yellow-500"
                        : isStepFailed
                        ? "bg-red-500"
                        : "bg-zinc-200"
                    }`}
                  >
                    {isStepCompleted && (
                      <Check className="h-3.5 w-3.5 text-white" />
                    )}
                    {isStepCurrent && (
                      <RefreshCw className="h-3 w-3 animate-spin text-white" />
                    )}
                    {isStepFailed && (
                      <X className="h-3.5 w-3.5 text-white" />
                    )}
                    {!isStepCompleted && !isStepCurrent && !isStepFailed && (
                      <span className="text-[10px] font-medium text-zinc-500">{step.id}</span>
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`text-sm transition-all duration-200 ${
                      isStepCompleted
                        ? "text-green-700 font-medium"
                        : isStepCurrent
                        ? "text-yellow-700 font-medium"
                        : isStepFailed
                        ? "text-red-700 font-medium"
                        : "text-zinc-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Status message */}
          {isCompleted && (
            <div className="mb-4 rounded-xl bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-700">
              Your scout report is ready to view
            </div>
          )}
          {isCancelled && (
            <div className="mb-4 rounded-xl bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-600">
              Report generation was cancelled.
            </div>
          )}
          {isError && (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-600">
              {errorMessage || "An error occurred while generating the report."}
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col gap-2">
            {isGenerating && (
              <>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                >
                  Continue Browsing
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  Cancel Generation
                </button>
              </>
            )}

            {(isCompleted || isCancelled || isError) && (
              <button
                type="button"
                onClick={onDismiss}
                className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                {isCompleted ? "View Report" : "Close"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
