"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  duration?: number;
  className?: string;
  formatFn?: (n: number) => string;
};

export function AnimatedNumber({ value, duration = 500, className = "", formatFn }: Props) {
  const [mounted, setMounted] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const endValue = value;
    const diff = endValue - startValue;

    // If value decreased or stayed same, snap immediately (no animation down)
    if (diff <= 0) {
      setDisplayValue(endValue);
      prevValueRef.current = endValue;
      return;
    }

    // Only animate when counting UP
    const startTime = performance.now();

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + diff * eased);
      
      setDisplayValue(current);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        prevValueRef.current = endValue;
      }
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  const formatted = formatFn
    ? formatFn(displayValue)
    : new Intl.NumberFormat("en-US").format(displayValue);

  if (!mounted) {
    return <span className={`tabular-nums ${className}`}>0</span>;
  }

  return <span className={`tabular-nums ${className}`}>{formatted}</span>;
}
