"use client";

import { usePathname } from "next/navigation";

export function NavPaddingWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Don't add padding on landing page (unauthenticated)
  if (pathname === "/") {
    return <>{children}</>;
  }

  return <div className="pt-14">{children}</div>;
}
