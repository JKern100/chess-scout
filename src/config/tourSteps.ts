import type { TourStep } from "@/components/tour/GuidedTour";

export const dashboardTourSteps: TourStep[] = [
  {
    target: "body",
    content: "Welcome to ChessScout! 🎯 This quick tour will show you how to prepare for your opponents like a pro. Let's get started!",
    placement: "center",
    disableBeacon: true,
    title: "Welcome to ChessScout",
  },
  {
    target: "[data-tour='add-player']",
    content: "Start by adding opponents you want to study. Just enter their Lichess username and we'll fetch their games automatically. The more you know about your opponents, the better prepared you'll be!",
    placement: "bottom",
    title: "Add Your Opponents",
  },
  {
    target: "[data-tour='style-opponent']",
    content: "Want to practice against a specific playing style? Create a simulated opponent based on aggressive, positional, or defensive styles. Perfect for targeted preparation!",
    placement: "bottom",
    title: "Create Style-Based Opponents",
  },
  {
    target: "[data-tour='opponent-cards']",
    content: "Your opponents appear here as cards. Each card shows sync status, game count, and style markers that reveal their playing tendencies at a glance.",
    placement: "top",
    title: "Your Opponent Library",
  },
  {
    target: "[data-tour='view-toggle']",
    content: "Switch between card and list views depending on how many opponents you're tracking. Use expand/collapse to show or hide details.",
    placement: "bottom",
    title: "Customize Your View",
  },
  {
    target: "[data-tour='nav-analysis']",
    content: "Head to Analysis to explore your opponent's move patterns interactively on a chessboard. See exactly what they play in each position!",
    placement: "bottom",
    title: "Deep Dive in Analysis",
  },
  {
    target: "[data-tour='nav-scout-report']",
    content: "Generate comprehensive Scout Reports with AI-powered insights about opening repertoires, playing style, and strategic recommendations.",
    placement: "bottom",
    title: "Get AI Scout Reports",
  },
  {
    target: "[data-tour='profile-menu']",
    content: "Access your account settings, restart this tour anytime, or sign out from here. You're all set to start scouting! 🏆",
    placement: "bottom",
    title: "You're Ready!",
  },
];

export const analysisTourSteps: TourStep[] = [
  {
    target: "body",
    content: "Welcome to the Analysis Board! 🔬 This is where you explore your opponent's actual move patterns and practice against their style.",
    placement: "center",
    disableBeacon: true,
    title: "Analysis Mode",
  },
  {
    target: "[data-tour='chessboard']",
    content: "Make moves on the board to explore positions. The opponent will respond based on their actual game history - you're seeing their real tendencies!",
    placement: "right",
    title: "Interactive Chessboard",
  },
  {
    target: "[data-tour='mode-toggle']",
    content: "Switch between Analysis (explore freely) and Simulation (opponent plays automatically based on their history). Simulation mode is great for practice!",
    placement: "bottom",
    title: "Analysis vs Simulation",
  },
  {
    target: "[data-tour='right-sidebar']",
    content: "This panel shows move statistics, filters, and analysis tools. Use the tabs at the top to switch between different views.",
    placement: "left",
    title: "Analysis Panel",
  },
  {
    target: "[data-tour='sidebar-tabs']",
    content: "These tabs let you switch between: Filters (time controls, dates), Preferences, Move Statistics (what your opponent plays), Lichess Book, and Scout Insights.",
    placement: "bottom",
    title: "Panel Tabs",
  },
  {
    target: "[data-tour='opponent-switcher']",
    content: "Quickly switch between opponents you're studying without leaving the analysis board. Compare how different players handle the same positions!",
    placement: "bottom",
    title: "Switch Opponents",
  },
  {
    target: "[data-tour='save-line']",
    content: "Found an interesting line? Click here to save it for later review. Your saved lines appear on your dashboard for quick access before a match.",
    placement: "top",
    title: "Save Key Lines",
  },
];

export const scoutReportTourSteps: TourStep[] = [
  {
    target: "body",
    content: "Welcome to the Scout Report! 📊 Get AI-powered insights and comprehensive statistics about your opponent's playing style.",
    placement: "center",
    disableBeacon: true,
    title: "Scout Report",
  },
  {
    target: "[data-tour='report-filters']",
    content: "Customize your report with filters. Analyze specific time controls, date ranges, or rated games only. Different contexts reveal different patterns!",
    placement: "bottom",
    title: "Report Filters",
  },
  {
    target: "[data-tour='generate-report']",
    content: "Click to generate or refresh the report. Our AI analyzes all available games and produces actionable insights tailored for your preparation.",
    placement: "bottom",
    title: "Generate Report",
  },
  {
    target: "[data-tour='style-markers']",
    content: "Style markers highlight your opponent's key characteristics: aggressive or defensive, early queen trades, castling preferences, and more. Use these to plan your strategy!",
    placement: "top",
    title: "Style Markers",
  },
  {
    target: "[data-tour='openings-section']",
    content: "See what openings your opponent favors as White and Black. Focus your prep on the lines you're most likely to face!",
    placement: "top",
    title: "Opening Repertoire",
  },
  {
    target: "[data-tour='ai-narrative']",
    content: "Our AI generates a personalized scouting brief with strategic recommendations. Use the Quick Summary for rapid prep or the Comprehensive Report for deep analysis.",
    placement: "top",
    title: "AI Analysis",
  },
  {
    target: "[data-tour='download-pdf']",
    content: "Download your report as a PDF to review offline or share with your coach. Perfect for tournament preparation! 🏆",
    placement: "bottom",
    title: "Export Your Report",
  },
];
