"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveOpponent } from "@/context/ActiveOpponentContext";

export default function OpponentsIndexPage() {
  const router = useRouter();
  const { activeOpponent, isLoading } = useActiveOpponent();

  useEffect(() => {
    if (isLoading) return;

    if (!activeOpponent?.platform || !activeOpponent?.username) {
      router.replace("/dashboard");
      return;
    }

    router.replace(
      `/opponents/${activeOpponent.platform}/${encodeURIComponent(activeOpponent.username)}/profile`
    );
  }, [activeOpponent, isLoading, router]);

  return null;
}
