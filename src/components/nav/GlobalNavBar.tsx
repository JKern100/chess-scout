"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LineChart, FileText, Settings, RefreshCw, Menu, X, Check } from "lucide-react";
import { useActiveOpponent } from "@/context/ActiveOpponentContext";
import { useImportQueue } from "@/context/ImportQueueContext";

type NavLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  matchPaths?: string[];
};

const NAV_LINKS: NavLink[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    matchPaths: ["/dashboard"],
  },
  {
    href: "/play?mode=analysis",
    label: "Analysis",
    icon: <LineChart className="h-4 w-4" />,
    matchPaths: ["/play"],
  },
  {
    href: "/opponents",
    label: "Scout Report",
    icon: <FileText className="h-4 w-4" />,
    matchPaths: ["/opponents"],
  },
];

function isActivePath(pathname: string, link: NavLink): boolean {
  if (link.matchPaths) {
    return link.matchPaths.some((p) => pathname.startsWith(p));
  }
  return pathname === link.href || pathname.startsWith(link.href);
}

export function GlobalNavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeOpponent, setActiveOpponent, availableOpponents, isLoading } = useActiveOpponent();
  const { isImporting } = useImportQueue();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [dropdownOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const filteredOpponents = availableOpponents.filter((o) =>
    o.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectOpponent = useCallback(
    (opponent: { platform: "lichess" | "chesscom"; username: string; rating?: number | null }) => {
      setActiveOpponent(opponent);
      setDropdownOpen(false);
      setSearchQuery("");

      // If user is currently on a Scout Report page, navigate to the newly selected opponent's report.
      if (pathname.startsWith("/opponents")) {
        router.replace(`/opponents/${opponent.platform}/${encodeURIComponent(opponent.username)}/profile`);
      }
    },
    [pathname, router, setActiveOpponent]
  );

  const handleScoutReportClick = useCallback(() => {
    // /opponents is an index route that redirects to the currently selected opponent's Scout Report.
    return "/opponents";
  }, [activeOpponent]);

  // Don't show nav on landing page (unauthenticated)
  if (pathname === "/") {
    return null;
  }

  return (
    <>
      {/* Main Nav Bar */}
      <nav className="fixed left-0 right-0 top-0 z-50 h-14 border-b border-zinc-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
          {/* Left: Logo + Nav Links (Desktop) */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-zinc-900">ChessScout</span>
              <span className="text-sm font-normal text-zinc-700">V1.01</span>
              <span className="text-sm italic text-zinc-500">Beta</span>
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden items-center gap-1 md:flex">
              {NAV_LINKS.map((link) => {
                const isActive = isActivePath(pathname, link);
                const href = link.label === "Scout Report" ? handleScoutReportClick() : link.href;
                return (
                  <Link
                    key={link.href}
                    href={href}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                  >
                    {link.icon}
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Center: Opponent Quick-Switcher (Desktop) - Hidden on Dashboard */}
          <div className={`${pathname === "/dashboard" ? "hidden" : "hidden md:block"}`} ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50"
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin text-zinc-400" />
              ) : activeOpponent ? (
                <>
                  <span className="max-w-[120px] truncate">{activeOpponent.username}</span>
                  {activeOpponent.rating ? (
                    <span className="text-xs text-zinc-500">({activeOpponent.rating})</span>
                  ) : null}
                </>
              ) : (
                <span className="text-zinc-500">Select opponent</span>
              )}
              <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute left-1/2 top-12 z-50 w-72 -translate-x-1/2 rounded-xl border border-zinc-200 bg-white shadow-lg">
                {/* Search Input */}
                <div className="border-b border-zinc-100 p-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search opponents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
                  />
                </div>

                {/* Opponent List */}
                <div className="max-h-64 overflow-y-auto p-1">
                  {filteredOpponents.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-zinc-500">
                      {availableOpponents.length === 0 ? "No opponents imported yet" : "No matches found"}
                    </div>
                  ) : (
                    filteredOpponents.map((o) => {
                      const isSelected =
                        activeOpponent?.platform === o.platform &&
                        activeOpponent?.username.toLowerCase() === o.username.toLowerCase();
                      return (
                        <button
                          key={`${o.platform}:${o.username}`}
                          type="button"
                          onClick={() => handleSelectOpponent(o)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isSelected ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{o.username}</span>
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                              {o.platform}
                            </span>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-zinc-600" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Utility Icons (Desktop) */}
          <div className="hidden items-center gap-2 md:flex">
            {/* Syncing Indicator */}
            {isImporting && (
              <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Syncing
              </div>
            )}

            {/* Settings Icon */}
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>

          {/* Mobile: Hamburger Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 md:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Mobile Menu Panel */}
      <div
        className={`fixed left-0 right-0 top-14 z-40 transform border-b border-zinc-200 bg-white shadow-lg transition-transform md:hidden ${
          mobileMenuOpen ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="p-4">
          {/* Mobile Opponent Switcher */}
          <div className="mb-4">
            <div className="mb-2 text-xs font-medium text-zinc-500">Current Opponent</div>
            <select
              value={activeOpponent ? `${activeOpponent.platform}:${activeOpponent.username}` : ""}
              onChange={(e) => {
                const [platform, username] = e.target.value.split(":");
                if (platform && username) {
                  const opp = availableOpponents.find(
                    (o) => o.platform === platform && o.username === username
                  );
                  if (opp) setActiveOpponent(opp);
                }
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900"
            >
              <option value="">Select opponent</option>
              {availableOpponents.map((o) => (
                <option key={`${o.platform}:${o.username}`} value={`${o.platform}:${o.username}`}>
                  {o.username} ({o.platform})
                </option>
              ))}
            </select>
          </div>

          {/* Mobile Nav Links */}
          <div className="grid gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = isActivePath(pathname, link);
              const href = link.label === "Scout Report" ? handleScoutReportClick() : link.href;
              return (
                <Link
                  key={link.href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Mobile Syncing Status */}
          {isImporting && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Syncing games...
            </div>
          )}
        </div>
      </div>
    </>
  );
}
