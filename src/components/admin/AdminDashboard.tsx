"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Shield,
  Users,
  Search,
  BarChart3,
  Activity,
  Clock,
  FileText,
  Crosshair,
  Swords,
  AlertTriangle,
  TrendingUp,
  Cpu,
  Database,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Trash2,
  X,
} from "lucide-react";
import { useAdminRedirect } from "@/hooks/useAdminGuard";
import Link from "next/link";
import {
  mockResourceUsage,
  formatRelativeTime,
  formatDuration,
  type ResourceUsage,
} from "@/data/mockUsers";

// User type matching API response
type AdminUser = {
  id: string;
  displayName: string;
  email: string | null;
  platform: string;
  platformUsername: string;
  createdAt: string;
  lastActive: string | null;
  status: "online" | "idle" | "offline" | "churning";
  metrics: {
    opponentsScouted: number;
    reportsGenerated: number;
    simulationsRun: number;
    totalTimeSpentMinutes: number;
  };
  onboardingCompleted: boolean;
};

type GlobalStats = {
  totalUsers: number;
  activeUsersToday: number;
  activeUsersWeek: number;
  totalScouts: number;
  totalReports: number;
  totalSimulations: number;
  avgSessionDuration: number;
  scoutToSimConversion: number;
  churnRiskCount: number;
};

type SortField = "displayName" | "lastActive" | "totalTime" | "reportsGenerated" | "opponentsScouted";
type SortDirection = "asc" | "desc";

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  color = "zinc",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: { value: number; label: string };
  color?: "zinc" | "orange" | "green" | "blue" | "red";
}) {
  const colorClasses = {
    zinc: "bg-zinc-100 text-zinc-600",
    orange: "bg-orange-100 text-orange-600",
    green: "bg-green-100 text-green-600",
    blue: "bg-blue-100 text-blue-600",
    red: "bg-red-100 text-red-600",
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend.value >= 0 ? "text-green-600" : "text-red-600"}`}>
            <TrendingUp className={`h-3 w-3 ${trend.value < 0 ? "rotate-180" : ""}`} />
            {Math.abs(trend.value)}% {trend.label}
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-zinc-900">{value}</div>
        <div className="text-sm text-zinc-500">{label}</div>
        {subValue && <div className="mt-1 text-xs text-zinc-400">{subValue}</div>}
      </div>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  label,
  color = "orange",
}: {
  value: number;
  max: number;
  label: string;
  color?: "orange" | "green" | "blue" | "red";
}) {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const colorClasses = {
    orange: "bg-orange-500",
    green: "bg-green-500",
    blue: "bg-blue-500",
    red: "bg-red-500",
  };

  const bgClasses = {
    orange: "bg-orange-100",
    green: "bg-green-100",
    blue: "bg-blue-100",
    red: "bg-red-100",
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-700">{label}</span>
        <span className="text-zinc-500">{percentage}%</span>
      </div>
      <div className={`h-2 w-full overflow-hidden rounded-full ${bgClasses[color]}`}>
        <div
          className={`h-2 rounded-full transition-all duration-500 ${colorClasses[color]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-zinc-400">
        {value.toLocaleString()} / {max.toLocaleString()}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminUser["status"] }) {
  const statusConfig = {
    online: { label: "Online", className: "bg-green-100 text-green-700" },
    idle: { label: "Idle", className: "bg-yellow-100 text-yellow-700" },
    offline: { label: "Offline", className: "bg-zinc-100 text-zinc-600" },
    churning: { label: "At Risk", className: "bg-red-100 text-red-700" },
  };

  const config = statusConfig[status];

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

type DeleteConfirmModalProps = {
  user: AdminUser | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  relatedCounts: {
    games: number;
    imports: number;
    opponentProfiles: number;
    styleMarkers: number;
    openingGraphNodes: number;
    savedLines?: number;
  } | null;
};

function DeleteConfirmModal({ user, isOpen, onClose, onConfirm, isDeleting, relatedCounts }: DeleteConfirmModalProps) {
  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-900">Delete User</h3>
        </div>

        <p className="mb-4 text-sm text-zinc-600">
          Are you sure you want to delete <strong>{user.displayName}</strong>? This action cannot be undone.
        </p>

        {relatedCounts && (
          <div className="mb-4 rounded-lg bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-700">The following data will be permanently deleted:</p>
            <ul className="space-y-1 text-xs text-zinc-600">
              <li>• {relatedCounts.games.toLocaleString()} games</li>
              <li>• {relatedCounts.imports.toLocaleString()} import jobs</li>
              <li>• {relatedCounts.opponentProfiles.toLocaleString()} opponent profiles</li>
              <li>• {relatedCounts.styleMarkers.toLocaleString()} style markers</li>
              <li>• {relatedCounts.openingGraphNodes.toLocaleString()} opening graph nodes</li>
              {typeof relatedCounts.savedLines === "number" && (
                <li>• {relatedCounts.savedLines.toLocaleString()} saved lines</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete User"}
          </button>
        </div>
      </div>
    </div>
  );
}

type UserRowProps = {
  user: AdminUser;
  onDeleteClick: (user: AdminUser) => void;
  canDelete: boolean;
};

function UserRow({ user, onDeleteClick, canDelete }: UserRowProps) {
  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-600">
            {user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-zinc-900">{user.displayName}</div>
            <div className="text-xs text-zinc-500">{user.platformUsername || user.platform}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-zinc-700">{user.lastActive ? formatRelativeTime(user.lastActive) : "Never"}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-zinc-700">{formatDuration(user.metrics.totalTimeSpentMinutes)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-zinc-600">
            <FileText className="h-3.5 w-3.5" />
            {user.metrics.reportsGenerated}
          </span>
          <span className="flex items-center gap-1 text-zinc-600">
            <Crosshair className="h-3.5 w-3.5" />
            {user.metrics.opponentsScouted}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={user.status} />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onDeleteClick(user)}
          disabled={!canDelete}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          title={canDelete ? "Delete user" : "Set SUPABASE_SERVICE_ROLE_KEY to enable admin deletion"}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </td>
    </tr>
  );
}

type RelatedDataCounts = {
  games: number;
  imports: number;
  opponentProfiles: number;
  styleMarkers: number;
  openingGraphNodes: number;
  savedLines?: number;
};

type OrphanCheckRow = {
  table: string;
  key: string;
  orphanCount: number;
};

export function AdminDashboard() {
  const { isAdmin, isLoading } = useAdminRedirect();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("lastActive");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [resourceUsage, setResourceUsage] = useState<ResourceUsage>(mockResourceUsage);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [serviceRoleAvailable, setServiceRoleAvailable] = useState<boolean>(true);

  // Orphan check state
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [orphansError, setOrphansError] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<OrphanCheckRow[] | null>(null);

  // Delete user state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [relatedCounts, setRelatedCounts] = useState<RelatedDataCounts | null>(null);

  // Fetch real data from API
  const fetchUsers = async () => {
    try {
      setIsRefreshing(true);
      setFetchError(null);
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch users (${res.status})`);
      }
      const data = await res.json();
      setUsers(data.users || []);
      setGlobalStats(data.globalStats || null);
      setApiWarning(typeof data.warning === "string" ? data.warning : null);
      setServiceRoleAvailable(Boolean(data.serviceRoleAvailable));
      setDataLoaded(true);
    } catch (err) {
      console.error("[AdminDashboard] Fetch error:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Fetch data on mount
  useEffect(() => {
    if (isAdmin && !dataLoaded) {
      void fetchUsers();
    }
  }, [isAdmin, dataLoaded]);

  // Filter and sort users
  const filteredUsers = useMemo(() => {
    let result = users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.platformUsername.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "displayName":
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case "lastActive":
          const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
          const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
          comparison = bTime - aTime;
          break;
        case "totalTime":
          comparison = b.metrics.totalTimeSpentMinutes - a.metrics.totalTimeSpentMinutes;
          break;
        case "reportsGenerated":
          comparison = b.metrics.reportsGenerated - a.metrics.reportsGenerated;
          break;
        case "opponentsScouted":
          comparison = b.metrics.opponentsScouted - a.metrics.opponentsScouted;
          break;
      }
      return sortDirection === "asc" ? -comparison : comparison;
    });

    return result;
  }, [users, searchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleRefresh = async () => {
    await fetchUsers();
  };

  // Delete user handlers
  const handleDeleteClick = async (user: AdminUser) => {
    setUserToDelete(user);
    setDeleteError(null);
    setRelatedCounts(null);
    setDeleteModalOpen(true);

    // Fetch related data counts for the confirmation modal
    try {
      const res = await fetch(`/api/admin/users/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setRelatedCounts(data.relatedDataCounts || null);
      }
    } catch {
      // Proceed without counts if fetch fails
    }
  };

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete user");
      }

      // Remove user from local state
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setDeleteModalOpen(false);
      setUserToDelete(null);
      setRelatedCounts(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModalOpen(false);
    setUserToDelete(null);
    setRelatedCounts(null);
    setDeleteError(null);
  };

  const runOrphanCheck = async () => {
    setOrphansOpen(true);
    setOrphansLoading(true);
    setOrphansError(null);
    setOrphans(null);
    try {
      const res = await fetch("/api/admin/orphans", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to run orphan check (${res.status})`);
      }
      setOrphans(Array.isArray(data.results) ? (data.results as OrphanCheckRow[]) : []);
    } catch (err) {
      setOrphansError(err instanceof Error ? err.message : "Failed to run orphan check");
    } finally {
      setOrphansLoading(false);
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-700"
    >
      {label}
      {sortField === field && (
        sortDirection === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
      )}
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!isAdmin) {
    return null; // Redirect handled by useAdminRedirect
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-12">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100">
                <Shield className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-zinc-900">Admin Dashboard</h1>
                <p className="mt-1 text-sm text-zinc-500">Monitor users, analyze performance, and manage platform operations.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/maintenance"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Maintenance Mode
              </Link>
              <Link
                href="/admin/ai-prompt"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                AI Prompt Editor
              </Link>
              <button
                type="button"
                onClick={runOrphanCheck}
                disabled={!serviceRoleAvailable}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={serviceRoleAvailable ? "Check for orphan records" : "Requires SUPABASE_SERVICE_ROLE_KEY"}
              >
                Orphan Check
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {(apiWarning || !serviceRoleAvailable) && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
              <div className="min-w-0">
                <div className="font-semibold">Admin user list may be incomplete</div>
                <div className="mt-1 text-amber-800">
                  {apiWarning ?? "Service role is unavailable. The dashboard cannot list all users due to RLS."}
                </div>
                <div className="mt-2 text-xs text-amber-800">
                  To see all registered users locally, set <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> in <span className="font-mono">.env.local</span>.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 pt-6">
        {/* Global Stats Cards */}
        {globalStats && (
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Users}
              label="Total Users"
              value={globalStats.totalUsers}
              subValue={`${globalStats.activeUsersToday} active today`}
              color="blue"
            />
            <StatCard
              icon={Crosshair}
              label="Total Scouts"
              value={globalStats.totalScouts.toLocaleString()}
              trend={{ value: 12, label: "this week" }}
              color="orange"
            />
            <StatCard
              icon={FileText}
              label="Reports Generated"
              value={globalStats.totalReports.toLocaleString()}
              trend={{ value: 8, label: "this week" }}
              color="green"
            />
            <StatCard
              icon={Swords}
              label="Simulations Run"
              value={globalStats.totalSimulations.toLocaleString()}
              subValue={`${globalStats.scoutToSimConversion}% scout-to-sim rate`}
              color="zinc"
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* User Directory */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-zinc-200 bg-white">
              <div className="border-b border-zinc-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-zinc-900">User Directory</h2>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-64 rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-4 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/50">
                      <th className="px-4 py-3 text-left">
                        <SortHeader field="displayName" label="User" />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader field="lastActive" label="Last Login" />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader field="totalTime" label="Time Spent" />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader field="reportsGenerated" label="Reports/Scouts" />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Status</span>
                      </th>
                      <th className="px-4 py-3 text-right">
                        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        onDeleteClick={handleDeleteClick}
                        canDelete={serviceRoleAvailable}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredUsers.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-zinc-500">
                  No users found matching &quot;{searchQuery}&quot;
                </div>
              )}

              <div className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
                Showing {filteredUsers.length} of {users.length} users
              </div>
            </div>
          </div>

          {/* Right Sidebar - Resource Usage & Insights */}
          <div className="space-y-6">
            {/* Resource Usage */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <Cpu className="h-5 w-5 text-zinc-500" />
                <h2 className="font-semibold text-zinc-900">Resource Usage</h2>
              </div>

              <div className="space-y-5">
                <ProgressBar
                  value={resourceUsage.aiTokensUsed}
                  max={resourceUsage.aiTokensLimit}
                  label="AI Tokens (Gemini)"
                  color={resourceUsage.aiTokensUsed / resourceUsage.aiTokensLimit > 0.9 ? "red" : "orange"}
                />
                <ProgressBar
                  value={resourceUsage.stockfishCalls}
                  max={resourceUsage.stockfishLimit}
                  label="Stockfish Calls"
                  color="blue"
                />

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Database className="h-4 w-4" />
                      <span className="text-xs">Database</span>
                    </div>
                    <div className="mt-1 text-lg font-semibold text-zinc-900">{resourceUsage.databaseSize}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Zap className="h-4 w-4" />
                      <span className="text-xs">API Calls</span>
                    </div>
                    <div className="mt-1 text-lg font-semibold text-zinc-900">{resourceUsage.apiCallsToday.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Strategic Insights */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-zinc-500" />
                <h2 className="font-semibold text-zinc-900">Strategic Insights</h2>
              </div>

              <div className="space-y-4">
                {/* Scout-to-Sim Conversion */}
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-zinc-700">Scout-to-Sim Rate</span>
                    </div>
                    <span className="text-lg font-bold text-green-600">{globalStats?.scoutToSimConversion || 0}%</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Users who scout an opponent proceed to simulate against them {globalStats?.scoutToSimConversion || 0}% of the time.
                  </p>
                </div>

                {/* Churn Risk */}
                <div className="rounded-lg border border-red-100 bg-red-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">Churn Risk</span>
                    </div>
                    <span className="text-lg font-bold text-red-600">{globalStats?.churnRiskCount || 0}</span>
                  </div>
                  <p className="mt-2 text-xs text-red-600/80">
                    Users inactive for 7+ days who may need re-engagement.
                  </p>
                </div>

                {/* Avg Session Duration */}
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-zinc-700">Avg Session</span>
                    </div>
                    <span className="text-lg font-bold text-zinc-900">
                      {formatDuration(globalStats?.avgSessionDuration || 0)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Average total time spent per user on the platform.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        user={userToDelete}
        isOpen={deleteModalOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
        relatedCounts={relatedCounts}
      />

      {/* Delete Error Toast */}
      {deleteError && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <span className="text-sm font-medium text-red-800">{deleteError}</span>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              className="ml-2 text-red-600 hover:text-red-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {orphansOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setOrphansOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => setOrphansOpen(false)}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-semibold text-zinc-900">Orphan Record Check</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Counts rows whose user reference no longer exists in <span className="font-mono">auth.users</span>.
            </p>

            <div className="mt-4">
              {orphansLoading && <div className="text-sm text-zinc-600">Running...</div>}
              {orphansError && <div className="text-sm text-red-600">{orphansError}</div>}
              {orphans && (
                <div className="overflow-hidden rounded-lg border border-zinc-200">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Table</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Key</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Orphans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orphans.map((r) => (
                        <tr key={`${r.table}:${r.key}`} className="border-t border-zinc-100">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-700">{r.table}</td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-700">{r.key}</td>
                          <td className="px-3 py-2 text-right text-zinc-700">{r.orphanCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setOrphansOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
