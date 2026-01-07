/**
 * Mock user data for Admin Dashboard Phase 1.
 * This will be replaced with real Supabase queries once metrics tracking is live.
 */

export type MockUser = {
  id: string;
  email: string;
  displayName: string;
  platform: "lichess" | "chesscom";
  platformUsername: string;
  avatarUrl?: string;
  createdAt: string;
  lastActive: string;
  status: "online" | "idle" | "offline" | "churning";
  metrics: {
    opponentsScouted: number;
    reportsGenerated: number;
    simulationsRun: number;
    sessionDurationMinutes: number;
    totalTimeSpentMinutes: number;
  };
};

export type GlobalStats = {
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

export type ResourceUsage = {
  aiTokensUsed: number;
  aiTokensLimit: number;
  stockfishCalls: number;
  stockfishLimit: number;
  databaseSize: string;
  apiCallsToday: number;
};

// Generate realistic timestamps
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

function minutesAgo(minutes: number): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
}

// Mock users with realistic data
export const mockUsers: MockUser[] = [
  {
    id: "usr_001",
    email: "jeff@chessscout.com",
    displayName: "JeffK",
    platform: "lichess",
    platformUsername: "Bazeenga2",
    createdAt: daysAgo(45),
    lastActive: minutesAgo(5),
    status: "online",
    metrics: {
      opponentsScouted: 87,
      reportsGenerated: 42,
      simulationsRun: 156,
      sessionDurationMinutes: 45,
      totalTimeSpentMinutes: 2340,
    },
  },
  {
    id: "usr_002",
    email: "maria.chess@gmail.com",
    displayName: "MariaGM",
    platform: "lichess",
    platformUsername: "MariaChess2024",
    createdAt: daysAgo(30),
    lastActive: hoursAgo(2),
    status: "idle",
    metrics: {
      opponentsScouted: 45,
      reportsGenerated: 23,
      simulationsRun: 89,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 1560,
    },
  },
  {
    id: "usr_003",
    email: "alex.petrov@yahoo.com",
    displayName: "AlexP",
    platform: "chesscom",
    platformUsername: "AlexPetrov99",
    createdAt: daysAgo(21),
    lastActive: daysAgo(1),
    status: "offline",
    metrics: {
      opponentsScouted: 32,
      reportsGenerated: 18,
      simulationsRun: 67,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 890,
    },
  },
  {
    id: "usr_004",
    email: "sarah.knight@outlook.com",
    displayName: "SarahK",
    platform: "lichess",
    platformUsername: "KnightRider_S",
    createdAt: daysAgo(14),
    lastActive: minutesAgo(30),
    status: "online",
    metrics: {
      opponentsScouted: 28,
      reportsGenerated: 15,
      simulationsRun: 52,
      sessionDurationMinutes: 28,
      totalTimeSpentMinutes: 720,
    },
  },
  {
    id: "usr_005",
    email: "chen.wei@proton.me",
    displayName: "WeiChen",
    platform: "lichess",
    platformUsername: "DragonMaster_W",
    createdAt: daysAgo(60),
    lastActive: daysAgo(12),
    status: "churning",
    metrics: {
      opponentsScouted: 56,
      reportsGenerated: 31,
      simulationsRun: 23,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 1890,
    },
  },
  {
    id: "usr_006",
    email: "mike.johnson@gmail.com",
    displayName: "MikeJ",
    platform: "chesscom",
    platformUsername: "ChessMike2000",
    createdAt: daysAgo(7),
    lastActive: hoursAgo(6),
    status: "idle",
    metrics: {
      opponentsScouted: 12,
      reportsGenerated: 8,
      simulationsRun: 34,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 320,
    },
  },
  {
    id: "usr_007",
    email: "emma.bishop@icloud.com",
    displayName: "EmmaB",
    platform: "lichess",
    platformUsername: "BishopQueen_E",
    createdAt: daysAgo(35),
    lastActive: daysAgo(9),
    status: "churning",
    metrics: {
      opponentsScouted: 41,
      reportsGenerated: 19,
      simulationsRun: 15,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 980,
    },
  },
  {
    id: "usr_008",
    email: "david.rook@hotmail.com",
    displayName: "DavidR",
    platform: "lichess",
    platformUsername: "RookMaster_D",
    createdAt: daysAgo(3),
    lastActive: minutesAgo(15),
    status: "online",
    metrics: {
      opponentsScouted: 5,
      reportsGenerated: 3,
      simulationsRun: 12,
      sessionDurationMinutes: 22,
      totalTimeSpentMinutes: 85,
    },
  },
  {
    id: "usr_009",
    email: "lisa.pawn@gmail.com",
    displayName: "LisaP",
    platform: "chesscom",
    platformUsername: "PawnStorm_Lisa",
    createdAt: daysAgo(18),
    lastActive: hoursAgo(4),
    status: "idle",
    metrics: {
      opponentsScouted: 23,
      reportsGenerated: 11,
      simulationsRun: 45,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 560,
    },
  },
  {
    id: "usr_010",
    email: "tom.castling@yahoo.com",
    displayName: "TomC",
    platform: "lichess",
    platformUsername: "CastlingKing_T",
    createdAt: daysAgo(50),
    lastActive: daysAgo(15),
    status: "churning",
    metrics: {
      opponentsScouted: 67,
      reportsGenerated: 28,
      simulationsRun: 8,
      sessionDurationMinutes: 0,
      totalTimeSpentMinutes: 1450,
    },
  },
];

// Calculate global stats from mock users
export function calculateGlobalStats(users: MockUser[]): GlobalStats {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const activeToday = users.filter((u) => new Date(u.lastActive) > oneDayAgo).length;
  const activeWeek = users.filter((u) => new Date(u.lastActive) > oneWeekAgo).length;

  const totalScouts = users.reduce((sum, u) => sum + u.metrics.opponentsScouted, 0);
  const totalReports = users.reduce((sum, u) => sum + u.metrics.reportsGenerated, 0);
  const totalSimulations = users.reduce((sum, u) => sum + u.metrics.simulationsRun, 0);

  const totalTime = users.reduce((sum, u) => sum + u.metrics.totalTimeSpentMinutes, 0);
  const avgSessionDuration = Math.round(totalTime / users.length);

  const scoutToSimConversion = totalScouts > 0 ? Math.round((totalSimulations / totalScouts) * 100) : 0;

  const churnRiskCount = users.filter((u) => new Date(u.lastActive) < sevenDaysAgo).length;

  return {
    totalUsers: users.length,
    activeUsersToday: activeToday,
    activeUsersWeek: activeWeek,
    totalScouts,
    totalReports,
    totalSimulations,
    avgSessionDuration,
    scoutToSimConversion,
    churnRiskCount,
  };
}

// Mock resource usage data
export const mockResourceUsage: ResourceUsage = {
  aiTokensUsed: 847500,
  aiTokensLimit: 1000000,
  stockfishCalls: 12340,
  stockfishLimit: 50000,
  databaseSize: "2.4 GB",
  apiCallsToday: 3420,
};

// Utility to format relative time
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Utility to format duration
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
