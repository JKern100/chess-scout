"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTour, type TourPage } from "@/context/TourContext";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export type TourStep = {
  target: string;
  title?: string;
  content: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
  disableBeacon?: boolean;
};

type Props = {
  page: TourPage;
  steps: TourStep[];
  autoStart?: boolean;
};

type Position = {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right" | "center";
};

function getTooltipPosition(
  targetRect: DOMRect | null,
  tooltipRect: { width: number; height: number },
  preferredPlacement: "top" | "bottom" | "left" | "right" | "center"
): Position {
  if (!targetRect || preferredPlacement === "center") {
    return {
      top: window.innerHeight / 2 - tooltipRect.height / 2,
      left: window.innerWidth / 2 - tooltipRect.width / 2,
      placement: "center",
    };
  }

  const padding = 16;
  const arrowOffset = 12;
  let placement = preferredPlacement;
  let top = 0;
  let left = 0;

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;

  switch (placement) {
    case "bottom":
      top = targetRect.bottom + arrowOffset;
      left = centerX - tooltipRect.width / 2;
      if (top + tooltipRect.height > window.innerHeight - padding) {
        placement = "top";
        top = targetRect.top - tooltipRect.height - arrowOffset;
      }
      break;
    case "top":
      top = targetRect.top - tooltipRect.height - arrowOffset;
      left = centerX - tooltipRect.width / 2;
      if (top < padding) {
        placement = "bottom";
        top = targetRect.bottom + arrowOffset;
      }
      break;
    case "right":
      top = centerY - tooltipRect.height / 2;
      left = targetRect.right + arrowOffset;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        placement = "left";
        left = targetRect.left - tooltipRect.width - arrowOffset;
      }
      break;
    case "left":
      top = centerY - tooltipRect.height / 2;
      left = targetRect.left - tooltipRect.width - arrowOffset;
      if (left < padding) {
        placement = "right";
        left = targetRect.right + arrowOffset;
      }
      break;
  }

  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
  top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));

  return { top, left, placement };
}

export function GuidedTour({ page, steps, autoStart = true }: Props) {
  const { startTour, endTour, tourRunning, activeTour, shouldAutoStartTour } = useTour();
  const [stepIndex, setStepIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (autoStart && shouldAutoStartTour(page)) {
      const timer = setTimeout(() => {
        startTour(page);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [mounted, autoStart, page, shouldAutoStartTour, startTour]);

  useEffect(() => {
    if (activeTour === page && tourRunning) {
      setStepIndex(0);
    }
  }, [activeTour, page, tourRunning]);

  const currentStep = steps[stepIndex];
  const isActive = activeTour === page && tourRunning && mounted;

  useLayoutEffect(() => {
    if (!isActive || !currentStep) {
      setPosition(null);
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      let target: Element | null = null;

      if (currentStep.target === "body") {
        setTargetRect(null);
        if (tooltipRef.current) {
          const rect = tooltipRef.current.getBoundingClientRect();
          setPosition(getTooltipPosition(null, { width: rect.width, height: rect.height }, "center"));
        }
        return;
      }

      target = document.querySelector(currentStep.target);
      if (!target) {
        target = document.querySelector(`[data-tour="${currentStep.target.replace("[data-tour='", "").replace("']", "")}"]`);
      }

      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);
        target.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
          if (tooltipRef.current) {
            const tooltipRect = tooltipRef.current.getBoundingClientRect();
            const newRect = target!.getBoundingClientRect();
            setTargetRect(newRect);
            setPosition(
              getTooltipPosition(newRect, { width: tooltipRect.width, height: tooltipRect.height }, currentStep.placement ?? "bottom")
            );
          }
        }, 100);
      } else {
        setTargetRect(null);
        if (tooltipRef.current) {
          const rect = tooltipRef.current.getBoundingClientRect();
          setPosition(getTooltipPosition(null, { width: rect.width, height: rect.height }, "center"));
        }
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isActive, currentStep, stepIndex]);

  const handleNext = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      endTour(page, true);
    }
  }, [stepIndex, steps.length, endTour, page]);

  const handleBack = useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1);
    }
  }, [stepIndex]);

  const handleSkip = useCallback(() => {
    endTour(page, true);
  }, [endTour, page]);

  if (!isActive || !currentStep) return null;

  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;
  const isCentered = !targetRect || currentStep.target === "body";

  return createPortal(
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-[9998]" style={{ pointerEvents: "none" }}>
        <svg className="absolute inset-0 h-full w-full">
          <defs>
            <mask id="tour-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - 8}
                  y={targetRect.top - 8}
                  width={targetRect.width + 16}
                  height={targetRect.height + 16}
                  rx="12"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.5)"
            mask="url(#tour-spotlight-mask)"
            style={{ pointerEvents: "auto" }}
            onClick={handleSkip}
          />
        </svg>
      </div>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[9999] w-[380px] max-w-[calc(100vw-32px)] rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        style={{
          top: position?.top ?? "50%",
          left: position?.left ?? "50%",
          transform: position ? "none" : "translate(-50%, -50%)",
          opacity: position ? 1 : 0,
          transition: "opacity 0.15s ease-out",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleSkip}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="p-5 pr-10">
          {currentStep.title && (
            <h3 className="text-base font-semibold text-zinc-900">{currentStep.title}</h3>
          )}
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">{currentStep.content}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              End Tour
            </button>
            <span className="text-xs text-zinc-400">
              {stepIndex + 1} / {steps.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isFirstStep && (
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800"
            >
              {isLastStep ? "Finish" : "Next"}
              {!isLastStep && <ChevronRight className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
