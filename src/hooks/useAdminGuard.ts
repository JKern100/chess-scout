"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Admin email(s) - can be extended to pull from environment variables
const ADMIN_EMAILS = [
  process.env.NEXT_PUBLIC_ADMIN_EMAIL,
  "jeff.kern@gmail.com", // Fallback
].filter(Boolean) as string[];

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

type AdminGuardResult = {
  isAdmin: boolean;
  isLoading: boolean;
  userEmail: string | null;
};

/**
 * Hook to check if the current user is an admin.
 * Returns isAdmin boolean, loading state, and user email.
 */
export function useAdminGuard(): AdminGuardResult {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function checkAdmin() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user?.email) {
          setUserEmail(user.email);
          const userEmailNormalized = normalizeEmail(user.email);
          const isAdminUser = ADMIN_EMAILS.some((adminEmail) => normalizeEmail(adminEmail) === userEmailNormalized);
          setIsAdmin(isAdminUser);
        } else {
          setIsAdmin(false);
          setUserEmail(null);
        }
      } catch {
        setIsAdmin(false);
        setUserEmail(null);
      } finally {
        setIsLoading(false);
      }
    }

    void checkAdmin();

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      void checkAdmin();
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { isAdmin, isLoading, userEmail };
}

/**
 * Hook that redirects non-admin users away from admin pages.
 * Use this at the top of admin page components.
 */
export function useAdminRedirect(redirectTo: string = "/dashboard"): AdminGuardResult {
  const router = useRouter();
  const { isAdmin, isLoading, userEmail } = useAdminGuard();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace(redirectTo);
    }
  }, [isAdmin, isLoading, redirectTo, router]);

  return { isAdmin, isLoading, userEmail };
}
