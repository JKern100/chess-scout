"use client";

import { useEffect } from "react";

type Props = {
  redirectPath?: string;
};

export function AuthRedirectCatcher({ redirectPath = "/auth/callback" }: Props) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const hasCode = url.searchParams.has("code");
      const hasTokenHash = url.searchParams.has("token_hash");
      const hasType = url.searchParams.has("type");

      if (!hasCode && !(hasTokenHash && hasType)) return;

      // If Supabase redirects back to / (root) with auth params, forward them to our
      // server callback route so it can exchange/verify and set cookies.
      if (url.pathname === redirectPath) return;

      const nextUrl = new URL(`${window.location.origin}${redirectPath}`);
      nextUrl.search = url.search;

      // Preserve an explicit next if present; otherwise default to dashboard.
      if (!nextUrl.searchParams.has("next")) {
        nextUrl.searchParams.set("next", "/dashboard");
      }

      window.location.replace(nextUrl.toString());
    } catch {
      // ignore
    }
  }, [redirectPath]);

  return null;
}
