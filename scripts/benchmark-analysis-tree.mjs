/**
 * Benchmark: PGN parsing + tree building performance
 * 
 * Tests 1k, 5k, 10k games at ply depths 2 and 6
 * Measures time and memory growth
 * 
 * Run: node scripts/benchmark-analysis-tree.mjs
 */

import { Chess } from 'chess.js';

// Simplified FEN normalization (first 4 fields only)
function normalizeFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen.trim();
  return parts.slice(0, 4).join(" ");
}

// Generate a realistic-ish PGN for benchmarking
function generateMockPgn(gameIndex) {
  const openings = [
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O",
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c6 8. Bd3 dxc4",
    "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7 8. O-O O-O",
    "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7",
    "1. e4 e6 2. d4 d5 3. Nc3 Bb4 4. e5 c5 5. a3 Bxc3+ 6. bxc3 Ne7 7. Qg4 Qc7 8. Qxg7 Rg8",
    "1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7",
  ];
  
  const middlegames = [
    "9. d4 Bg4 10. Be3 d5 11. h3 Bh5 12. Nbd2 exd4 13. cxd4 d5 14. e5 Ne4",
    "9. Bxc4 b5 10. Bd3 a6 11. e4 c5 12. e5 cxd4 13. Nxd4 Bc5 14. Be3 Ne5",
    "9. f3 Be6 10. Be3 Nbd7 11. Qd2 Rc8 12. g4 h5 13. g5 Nh7 14. h4 b5",
    "9. Ne1 Nd7 10. Nd3 f5 11. f3 Nf6 12. Bd2 f4 13. c5 g5 14. Rc1 Ng6",
    "9. Qxh8+ Kd7 10. Qxh6 cxd4 11. Ne2 Nbc6 12. f4 Qb6 13. Qd2 dxc3 14. Qxc3 Nf5",
    "9. Bd3 Bxd3 10. Qxd3 e6 11. Bf4 Qa5+ 12. Bd2 Qc7 13. O-O-O Ngf6 14. Ne4 O-O-O",
  ];
  
  const results = ["1-0", "0-1", "1/2-1/2"];
  const speeds = ["bullet", "blitz", "rapid"];
  
  const opening = openings[gameIndex % openings.length];
  const middle = middlegames[gameIndex % middlegames.length];
  const result = results[gameIndex % results.length];
  const speed = speeds[gameIndex % speeds.length];
  const white = gameIndex % 2 === 0 ? "TestOpponent" : "TestUser";
  const black = gameIndex % 2 === 0 ? "TestUser" : "TestOpponent";
  
  return `[Event "Rated ${speed} game"]
[Site "https://lichess.org/abcd${gameIndex}"]
[Date "2024.${String((gameIndex % 12) + 1).padStart(2, '0')}.${String((gameIndex % 28) + 1).padStart(2, '0')}"]
[White "${white}"]
[Black "${black}"]
[Result "${result}"]
[WhiteElo "1800"]
[BlackElo "1750"]
[Speed "${speed}"]
[Rated "true"]
[TimeControl "180+0"]

${opening} ${middle} ${result}`;
}

// Build tree from games, tracking stats per position
function buildTree(pgns, maxPly, opponentUsername) {
  const tree = new Map(); // positionKey -> { moves: Map<uci, stats> }
  let gamesProcessed = 0;
  let parseErrors = 0;
  
  for (const pgn of pgns) {
    const chess = new Chess();
    try {
      chess.loadPgn(pgn, { strict: false });
    } catch {
      parseErrors++;
      continue;
    }
    
    // Determine opponent color from PGN
    const whiteMatch = pgn.match(/\[White\s+"([^"]+)"\]/i);
    const blackMatch = pgn.match(/\[Black\s+"([^"]+)"\]/i);
    const white = whiteMatch?.[1]?.toLowerCase() ?? "";
    const black = blackMatch?.[1]?.toLowerCase() ?? "";
    const oppLower = opponentUsername.toLowerCase();
    const oppColor = white === oppLower ? "w" : black === oppLower ? "b" : null;
    
    if (!oppColor) continue;
    
    // Get result
    const resultMatch = pgn.match(/\[Result\s+"([^"]+)"\]/i);
    const result = resultMatch?.[1] ?? "*";
    
    const verbose = chess.history({ verbose: true });
    const replay = new Chess();
    
    let ply = 0;
    for (const mv of verbose) {
      if (ply >= maxPly) break;
      
      const fenKey = normalizeFen(replay.fen());
      const moveColor = replay.turn();
      const uci = `${mv.from}${mv.to}${mv.promotion || ""}`;
      
      try {
        replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      } catch {
        break;
      }
      
      // Only track opponent's moves
      if (moveColor === oppColor) {
        let pos = tree.get(fenKey);
        if (!pos) {
          pos = { moves: new Map() };
          tree.set(fenKey, pos);
        }
        
        let stats = pos.moves.get(uci);
        if (!stats) {
          stats = { uci, san: mv.san, count: 0, win: 0, loss: 0, draw: 0 };
          pos.moves.set(uci, stats);
        }
        
        stats.count++;
        if (result === "1/2-1/2") stats.draw++;
        else if (result === "1-0") {
          if (oppColor === "w") stats.win++;
          else stats.loss++;
        } else if (result === "0-1") {
          if (oppColor === "b") stats.win++;
          else stats.loss++;
        }
      }
      
      ply++;
    }
    
    gamesProcessed++;
  }
  
  return { tree, gamesProcessed, parseErrors };
}

// Run benchmark
async function runBenchmark() {
  console.log("=== Analysis Tree Benchmark ===\n");
  
  const gameCounts = [1000, 5000, 10000];
  const plyDepths = [2, 6, 20];
  
  // Pre-generate all PGNs
  console.log("Generating mock PGNs...");
  const maxGames = Math.max(...gameCounts);
  const allPgns = [];
  for (let i = 0; i < maxGames; i++) {
    allPgns.push(generateMockPgn(i));
  }
  console.log(`Generated ${maxGames} mock PGNs\n`);
  
  // Get baseline memory
  if (global.gc) global.gc();
  const baselineMemory = process.memoryUsage().heapUsed;
  
  const results = [];
  
  for (const gameCount of gameCounts) {
    const pgns = allPgns.slice(0, gameCount);
    
    for (const maxPly of plyDepths) {
      // Force GC if available
      if (global.gc) global.gc();
      const memBefore = process.memoryUsage().heapUsed;
      
      const start = performance.now();
      const { tree, gamesProcessed, parseErrors } = buildTree(pgns, maxPly, "TestOpponent");
      const elapsed = performance.now() - start;
      
      const memAfter = process.memoryUsage().heapUsed;
      const memGrowthMB = (memAfter - memBefore) / (1024 * 1024);
      
      const positionCount = tree.size;
      let moveCount = 0;
      for (const pos of tree.values()) {
        moveCount += pos.moves.size;
      }
      
      results.push({
        games: gameCount,
        maxPly,
        timeMs: elapsed.toFixed(1),
        positions: positionCount,
        moves: moveCount,
        memGrowthMB: memGrowthMB.toFixed(2),
        gamesProcessed,
        parseErrors,
      });
      
      console.log(`${gameCount} games, ply ${maxPly}: ${elapsed.toFixed(1)}ms, ${positionCount} positions, ${moveCount} moves, +${memGrowthMB.toFixed(2)}MB`);
    }
    console.log("");
  }
  
  // Summary table
  console.log("\n=== Summary ===\n");
  console.log("Games\tPly\tTime(ms)\tPositions\tMoves\tMem(MB)");
  console.log("-----\t---\t--------\t---------\t-----\t-------");
  for (const r of results) {
    console.log(`${r.games}\t${r.maxPly}\t${r.timeMs}\t\t${r.positions}\t\t${r.moves}\t${r.memGrowthMB}`);
  }
  
  // Recommendations
  console.log("\n=== Recommendations ===\n");
  const ply2_1k = results.find(r => r.games === 1000 && r.maxPly === 2);
  const ply6_5k = results.find(r => r.games === 5000 && r.maxPly === 6);
  const ply20_10k = results.find(r => r.games === 10000 && r.maxPly === 20);
  
  console.log(`First paint (50 games, ply 2): ~${(parseFloat(ply2_1k?.timeMs ?? "0") / 20).toFixed(1)}ms estimated`);
  console.log(`Progressive build (5k games, ply 6): ${ply6_5k?.timeMs}ms`);
  console.log(`Full build (10k games, ply 20): ${ply20_10k?.timeMs}ms`);
  console.log(`\nPeak memory for 10k games: ~${ply20_10k?.memGrowthMB}MB`);
}

runBenchmark().catch(console.error);
