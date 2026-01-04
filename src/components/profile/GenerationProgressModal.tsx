"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  isOpen: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  status: "idle" | "generating" | "completed" | "cancelled" | "error";
  errorMessage?: string | null;
};

const GENERATION_STEPS = [
  { id: 1, label: "Loading game data", duration: 800 },
  { id: 2, label: "Parsing PGN notation", duration: 1200 },
  { id: 3, label: "Classifying openings", duration: 1000 },
  { id: 4, label: "Analyzing play style", duration: 1500 },
  { id: 5, label: "Computing repertoire patterns", duration: 1200 },
  { id: 6, label: "Calculating win/loss statistics", duration: 800 },
  { id: 7, label: "Generating style markers", duration: 1400 },
  { id: 8, label: "Finalizing report", duration: 600 },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function GenerationProgressModal({
  isOpen,
  onCancel,
  onDismiss,
  status,
  errorMessage,
}: Props) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const stepIndexRef = useRef(0);

  useEffect(() => {
    if (status === "generating") {
      setCompletedSteps([]);
      setCurrentStep(1);
      stepIndexRef.current = 0;

      const advanceStep = () => {
        const idx = stepIndexRef.current;
        if (idx >= GENERATION_STEPS.length) return;

        const step = GENERATION_STEPS[idx];
        setCurrentStep(step.id);

        timerRef.current = setTimeout(() => {
          setCompletedSteps((prev) => [...prev, step.id]);
          stepIndexRef.current += 1;

          if (stepIndexRef.current < GENERATION_STEPS.length) {
            advanceStep();
          }
        }, step.duration);
      };

      advanceStep();

      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    } else if (status === "completed") {
      setCompletedSteps(GENERATION_STEPS.map((s) => s.id));
      setCurrentStep(GENERATION_STEPS.length + 1);
    } else if (status === "cancelled" || status === "error") {
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [status]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 text-center">
          <h3 className="text-lg font-semibold text-neutral-100">
            {isGenerating && "Generating Scout Report"}
            {isCompleted && "Report Generated!"}
            {isCancelled && "Generation Cancelled"}
            {isError && "Generation Failed"}
          </h3>
          {isGenerating && (
            <p className="mt-1 text-xs text-neutral-500">
              You can dismiss and continue browsing
            </p>
          )}
        </div>

        {/* Checklist */}
        <div className="mb-5 space-y-2">
          {GENERATION_STEPS.map((step) => {
            const isStepCompleted = completedSteps.includes(step.id);
            const isStepCurrent = currentStep === step.id && isGenerating;
            const isStepPending = !isStepCompleted && !isStepCurrent;
            const isStepFailed = isError && currentStep === step.id;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-300 ${
                  isStepCompleted
                    ? "bg-green-500/10"
                    : isStepCurrent
                    ? "bg-yellow-500/10"
                    : isStepFailed
                    ? "bg-red-500/10"
                    : "bg-neutral-800/50"
                }`}
              >
                {/* Icon */}
                <div
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                    isStepCompleted
                      ? "bg-green-500 scale-100"
                      : isStepCurrent
                      ? "bg-yellow-500/20 scale-100"
                      : isStepFailed
                      ? "bg-red-500 scale-100"
                      : "bg-neutral-700 scale-90 opacity-50"
                  }`}
                >
                  {isStepCompleted && (
                    <CheckIcon className="h-3.5 w-3.5 text-white animate-in zoom-in duration-200" />
                  )}
                  {isStepCurrent && (
                    <SpinnerIcon className="h-4 w-4 animate-spin text-yellow-500" />
                  )}
                  {isStepFailed && (
                    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {isStepPending && !isStepFailed && (
                    <div className="h-2 w-2 rounded-full bg-neutral-500" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-sm transition-all duration-300 ${
                    isStepCompleted
                      ? "text-green-400 font-medium"
                      : isStepCurrent
                      ? "text-yellow-400 font-medium"
                      : isStepFailed
                      ? "text-red-400 font-medium"
                      : "text-neutral-500"
                  }`}
                >
                  {step.label}
                </span>

                {/* Checkmark animation for completed */}
                {isStepCompleted && (
                  <div className="ml-auto">
                    <span className="text-xs text-green-500/70">✓</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Status message */}
        {isCompleted && (
          <div className="mb-4 flex items-center justify-center gap-2 text-green-400">
            <CheckIcon className="h-5 w-5" />
            <span className="text-sm font-medium">Your scout report is ready to view</span>
          </div>
        )}
        {isCancelled && (
          <div className="mb-4 text-center text-sm text-neutral-400">
            Report generation was cancelled.
          </div>
        )}
        {isError && (
          <div className="mb-4 text-center text-sm text-red-400">
            {errorMessage || "An error occurred while generating the report."}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {isGenerating && (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="w-full rounded-xl bg-red-500/20 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                Cancel Generation
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="w-full rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
              >
                Continue Browsing
              </button>
            </>
          )}

          {(isCompleted || isCancelled || isError) && (
            <button
              type="button"
              onClick={onDismiss}
              className="w-full rounded-xl bg-yellow-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-yellow-400"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
