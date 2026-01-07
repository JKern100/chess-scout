"use client";

import Link from "next/link";
import {
  BookOpen,
  Target,
  Swords,
  FileText,
  Users,
  TrendingUp,
  Clock,
  Search,
  Zap,
  Shield,
  ArrowLeft,
  ChevronRight,
  Lightbulb,
  BarChart3,
  Brain,
  Crosshair,
} from "lucide-react";

type Section = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
};

const sections: Section[] = [
  { id: "getting-started", title: "Getting Started", icon: Zap },
  { id: "game-sync", title: "Game Sync & Import", icon: Clock },
  { id: "scout-reports", title: "Scout Reports", icon: FileText },
  { id: "shadow-boxer", title: "Shadow Boxer Simulator", icon: Swords },
  { id: "opponent-scouting", title: "Opponent Scouting", icon: Target },
  { id: "analysis-board", title: "Analysis Board", icon: BarChart3 },
  { id: "tips", title: "Pro Tips", icon: Lightbulb },
  { id: "faq", title: "FAQ", icon: BookOpen },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to ChessScout
            </Link>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              <span className="font-semibold text-zinc-900">User Guide</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Hero */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-zinc-900 mb-4">
            Welcome to ChessScout
          </h1>
          <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
            Your AI-powered chess preparation assistant. Learn how to scout opponents,
            practice against their style, and gain a competitive edge in your games.
          </p>
        </div>

        {/* Quick Navigation */}
        <nav className="mb-12 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-4">
            Quick Navigation
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:border-zinc-200 transition-colors"
              >
                <section.icon className="h-4 w-4 text-zinc-500" />
                {section.title}
              </a>
            ))}
          </div>
        </nav>

        {/* Getting Started */}
        <section id="getting-started" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <Zap className="h-5 w-5 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Getting Started</h2>
          </div>
          
          <div className="prose prose-zinc max-w-none">
            <p className="text-zinc-600 leading-relaxed">
              ChessScout helps you prepare for chess games by analyzing your opponents&apos; playing
              patterns and letting you practice against their style. Here&apos;s how to get started:
            </p>
            
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-semibold">1</div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 mb-1">Connect Your Chess Account</h3>
                    <p className="text-sm text-zinc-600">
                      Link your Lichess account to import your game history. We analyze your most recent
                      1,000 games to build your personal Scout profile.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-semibold">2</div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 mb-1">Generate Your Scout Report</h3>
                    <p className="text-sm text-zinc-600">
                      Once your games are synced, generate your personal Scout report to see AI-powered
                      insights about your playing style, strengths, and areas for improvement.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-semibold">3</div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 mb-1">Scout Your Opponents</h3>
                    <p className="text-sm text-zinc-600">
                      Enter an opponent&apos;s username to analyze their games and discover their tendencies,
                      favorite openings, and predictable moves.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-semibold">4</div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 mb-1">Practice with Shadow Boxer</h3>
                    <p className="text-sm text-zinc-600">
                      Use our unique simulator to practice against a virtual opponent that plays exactly
                      like your next real opponent would. Build muscle memory for their favorite lines.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Game Sync */}
        <section id="game-sync" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Game Sync & Import</h2>
          </div>
          
          <div className="rounded-xl border border-zinc-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6 mb-6">
            <h3 className="font-semibold text-zinc-900 mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-600" />
              Why 1,000 Games?
            </h3>
            <p className="text-sm text-zinc-700 leading-relaxed">
              ChessScout imports your most recent <strong>1,000 games</strong> by default. This provides
              enough data to identify consistent patterns and tendencies, while keeping the import fast.
              As you play more games, use the <strong>Refresh</strong> button to sync your latest games!
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">What Gets Imported?</h3>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span>All rated and casual games from your connected platform</span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span>Bullet, Blitz, Rapid, Classical, and Correspondence time controls</span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span>Move-by-move data for opening analysis</span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span>Game results and timestamps for trend analysis</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">Import Speed</h3>
              <p className="text-sm text-zinc-600 mb-3">
                Import times vary based on your game count:
              </p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-lg font-bold text-zinc-900">~1 min</div>
                  <div className="text-xs text-zinc-500">&lt; 1,000 games</div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-lg font-bold text-zinc-900">~3 min</div>
                  <div className="text-xs text-zinc-500">1,000 - 5,000</div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-lg font-bold text-zinc-900">~10 min</div>
                  <div className="text-xs text-zinc-500">5,000+ games</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Scout Reports */}
        <section id="scout-reports" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Scout Reports</h2>
          </div>

          <p className="text-zinc-600 mb-6 leading-relaxed">
            Scout Reports are AI-generated analyses of a player&apos;s chess tendencies. Each report includes:
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold text-zinc-900">AI Narrative</h3>
              </div>
              <p className="text-sm text-zinc-600">
                A comprehensive written analysis describing the player&apos;s style, strengths,
                weaknesses, and tactical tendencies in plain English.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-zinc-900">Opening Statistics</h3>
              </div>
              <p className="text-sm text-zinc-600">
                Detailed breakdown of favorite openings as White and Black, with win rates
                and frequency data.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-zinc-900">Performance Metrics</h3>
              </div>
              <p className="text-sm text-zinc-600">
                Win/draw/loss ratios, average game length, time control preferences,
                and rating trends over time.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <Crosshair className="h-5 w-5 text-red-600" />
                <h3 className="font-semibold text-zinc-900">Habit Detection</h3>
              </div>
              <p className="text-sm text-zinc-600">
                Identifies highly predictable moves where the player makes the same choice
                90%+ of the time—key intel for preparation.
              </p>
            </div>
          </div>
        </section>

        {/* Shadow Boxer */}
        <section id="shadow-boxer" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
              <Swords className="h-5 w-5 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Shadow Boxer Simulator</h2>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-gradient-to-br from-red-50 to-orange-50 p-6 mb-6">
            <p className="text-zinc-700 leading-relaxed">
              <strong>Shadow Boxer</strong> is ChessScout&apos;s signature feature. It creates a virtual
              sparring partner that plays exactly like your opponent would, based on their actual
              game history. Practice lines you&apos;ll actually face in your next match.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-3">How It Works</h3>
              <ol className="space-y-3 text-sm text-zinc-600">
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">1</span>
                  <span>Select an opponent you&apos;ve scouted</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">2</span>
                  <span>Choose your color (White or Black)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">3</span>
                  <span>The simulator plays moves based on your opponent&apos;s actual game history</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">4</span>
                  <span>Practice your preparation and build familiarity with their style</span>
                </li>
              </ol>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-3">Scout Insights Panel</h3>
              <p className="text-sm text-zinc-600 mb-3">
                During simulation, the Scout Insights panel shows you real-time information:
              </p>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span><strong>Predicted moves</strong> with probability percentages</span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span><strong>Habit alerts</strong> when your opponent is highly predictable</span>
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="h-4 w-4 mt-0.5 text-zinc-400 shrink-0" />
                  <span><strong>Sample size</strong> showing how many games inform the prediction</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Opponent Scouting */}
        <section id="opponent-scouting" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
              <Target className="h-5 w-5 text-purple-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Opponent Scouting</h2>
          </div>

          <p className="text-zinc-600 mb-6 leading-relaxed">
            Scout any Lichess player to analyze their playing style before your match. The Fast Import
            system makes opponent analysis quick and efficient.
          </p>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-3">How to Scout an Opponent</h3>
              <ol className="space-y-3 text-sm text-zinc-600">
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-600">1</span>
                  <span>Navigate to the <strong>Opponents</strong> section</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-600">2</span>
                  <span>Enter your opponent&apos;s Lichess username</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-600">3</span>
                  <span>Wait for the quick import (usually under 2 minutes)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-600">4</span>
                  <span>View their Scout Report and practice with Shadow Boxer</span>
                </li>
              </ol>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-3">Opponent Data Retention</h3>
              <p className="text-sm text-zinc-600">
                Scouted opponents are saved to your account for 14 days. You can refresh their data
                anytime to get the latest games, or scout them again after expiration.
              </p>
            </div>
          </div>
        </section>

        {/* Analysis Board */}
        <section id="analysis-board" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100">
              <BarChart3 className="h-5 w-5 text-cyan-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Analysis Board</h2>
          </div>

          <p className="text-zinc-600 mb-6 leading-relaxed">
            The Analysis Board provides a full-featured chess board with Stockfish engine analysis
            and opening explorer integration.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">Engine Analysis</h3>
              <p className="text-sm text-zinc-600">
                Stockfish 17 runs directly in your browser, providing real-time evaluation
                and best move suggestions.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">Opening Explorer</h3>
              <p className="text-sm text-zinc-600">
                See master games and Lichess player statistics for any position to understand
                popular continuations.
              </p>
            </div>
          </div>
        </section>

        {/* Pro Tips */}
        <section id="tips" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
              <Lightbulb className="h-5 w-5 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Pro Tips</h2>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50 p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">🎯 Focus on Habits</h3>
              <p className="text-sm text-zinc-600">
                Pay special attention to moves marked as &quot;habits&quot; (90%+ frequency). These are
                positions where you can confidently prepare a specific response.
              </p>
            </div>

            <div className="rounded-xl border-l-4 border-blue-400 bg-blue-50 p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">🔄 Practice Both Colors</h3>
              <p className="text-sm text-zinc-600">
                Use Shadow Boxer to practice as both White and Black against your opponent.
                You never know which color you&apos;ll get in a tournament.
              </p>
            </div>

            <div className="rounded-xl border-l-4 border-green-400 bg-green-50 p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">📊 Check Sample Sizes</h3>
              <p className="text-sm text-zinc-600">
                Predictions based on 50+ games are highly reliable. Be cautious with patterns
                from fewer games—they might not represent true tendencies.
              </p>
            </div>

            <div className="rounded-xl border-l-4 border-purple-400 bg-purple-50 p-5">
              <h3 className="font-semibold text-zinc-900 mb-2">⏱️ Filter by Time Control</h3>
              <p className="text-sm text-zinc-600">
                If you&apos;re preparing for a Blitz tournament, filter your opponent&apos;s games
                to Blitz only. Playing styles often differ between time controls.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mb-16 scroll-mt-24">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100">
              <BookOpen className="h-5 w-5 text-zinc-600" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-4">
            <details className="group rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-zinc-900">
                Is my chess account data secure?
                <ChevronRight className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-5 text-sm text-zinc-600">
                Yes. We only read publicly available game data from Lichess. We never access
                your password or private account settings. Your data is stored securely and
                never shared with third parties.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-zinc-900">
                Why can&apos;t I scout Chess.com players?
                <ChevronRight className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-5 text-sm text-zinc-600">
                Chess.com support is coming soon! Currently, ChessScout supports Lichess players.
                We&apos;re working on Chess.com integration and will announce when it&apos;s available.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-zinc-900">
                How accurate are the predictions?
                <ChevronRight className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-5 text-sm text-zinc-600">
                Predictions are based on actual game data, so they reflect real playing patterns.
                Accuracy improves with more games. For positions with 50+ game samples, predictions
                are highly reliable. Always check the sample size indicator.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-zinc-900">
                Can I export my Scout Reports?
                <ChevronRight className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-5 text-sm text-zinc-600">
                Report export functionality is on our roadmap. For now, you can view all reports
                directly in ChessScout and access them anytime from your account.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between p-5 font-semibold text-zinc-900">
                The import seems stuck. What should I do?
                <ChevronRight className="h-5 w-5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-5 text-sm text-zinc-600">
                Large game histories can take 5-10 minutes to import. If the progress hasn&apos;t
                moved for over 5 minutes, try refreshing the page. The import will resume from
                where it left off. If issues persist, contact support.
              </div>
            </details>
          </div>
        </section>

        {/* Footer CTA */}
        <div className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 to-zinc-800 p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Ready to Scout?</h2>
          <p className="text-zinc-400 mb-6 max-w-md mx-auto">
            Start analyzing opponents and practicing with Shadow Boxer to gain your competitive edge.
          </p>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            Go to ChessScout
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-zinc-50 py-8">
        <div className="mx-auto max-w-4xl px-6 text-center text-sm text-zinc-500">
          <p>ChessScout User Guide • Last updated January 2026</p>
        </div>
      </footer>
    </div>
  );
}
