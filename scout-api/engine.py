"""
Stockfish engine wrapper for Scout API.
Provides Multi-PV analysis with configurable depth.
"""

import chess
import chess.engine
from typing import List, Dict, Any, Optional
import asyncio


class EngineWrapper:
    """Wrapper for Stockfish engine with Multi-PV support."""
    
    def __init__(self, stockfish_path: str = "stockfish"):
        """Initialize the engine."""
        self.stockfish_path = stockfish_path
        self.engine: Optional[chess.engine.SimpleEngine] = None
        self._initialize()
    
    def _initialize(self):
        """Start the Stockfish engine process."""
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(self.stockfish_path)
            # Configure engine options
            self.engine.configure({
                "Threads": 2,
                "Hash": 128,  # MB
            })
        except Exception as e:
            print(f"Warning: Could not initialize Stockfish at {self.stockfish_path}: {e}")
            self.engine = None
    
    def is_ready(self) -> bool:
        """Check if engine is ready."""
        return self.engine is not None
    
    def analyze_position(
        self,
        fen: str,
        depth: int = 18,
        multipv: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Analyze a position and return top N moves with evaluations.
        
        Returns list of dicts with:
        - move_uci: UCI notation
        - move_san: SAN notation
        - score_cp: Centipawn score (from side to move perspective)
        - score_mate: Mate in N (if applicable)
        - rank: 1-indexed ranking
        - pv: Principal variation (list of moves)
        """
        if not self.engine:
            return []
        
        try:
            board = chess.Board(fen)
            
            # Run Multi-PV analysis
            analysis = self.engine.analyse(
                board,
                chess.engine.Limit(depth=depth),
                multipv=multipv
            )
            
            results = []
            for i, info in enumerate(analysis):
                if "pv" not in info or len(info["pv"]) == 0:
                    continue
                
                move = info["pv"][0]
                score = info.get("score")
                
                # Extract score
                score_cp = None
                score_mate = None
                if score:
                    pov_score = score.relative  # From side to move perspective
                    if pov_score.is_mate():
                        score_mate = pov_score.mate()
                        # Convert mate to large centipawn value for comparison
                        score_cp = 10000 if pov_score.mate() > 0 else -10000
                    else:
                        score_cp = pov_score.score()
                
                results.append({
                    "move_uci": move.uci(),
                    "move_san": board.san(move),
                    "score_cp": score_cp or 0,
                    "score_mate": score_mate,
                    "rank": i + 1,
                    "pv": [m.uci() for m in info["pv"][:5]],
                    "depth": info.get("depth", depth)
                })
            
            return results
            
        except Exception as e:
            print(f"Engine analysis error: {e}")
            return []
    
    def get_best_move(self, fen: str, depth: int = 18) -> Optional[str]:
        """Get the single best move for a position."""
        analysis = self.analyze_position(fen, depth=depth, multipv=1)
        if analysis:
            return analysis[0]["move_san"]
        return None
    
    def evaluate_move(self, fen: str, move_san: str, depth: int = 18) -> Optional[int]:
        """
        Evaluate a specific move by playing it and analyzing the resulting position.
        Returns centipawn evaluation from the original side's perspective.
        """
        if not self.engine:
            return None
        
        try:
            board = chess.Board(fen)
            move = board.parse_san(move_san)
            board.push(move)
            
            # Analyze the position after the move
            analysis = self.engine.analyse(
                board,
                chess.engine.Limit(depth=depth),
                multipv=1
            )
            
            if analysis and "score" in analysis[0]:
                score = analysis[0]["score"].relative
                if score.is_mate():
                    # Negate because we're looking from opponent's view
                    return -10000 if score.mate() > 0 else 10000
                else:
                    return -score.score()  # Negate to get original side's perspective
            
            return None
            
        except Exception as e:
            print(f"Move evaluation error: {e}")
            return None
    
    def analyze_single_move(self, fen: str, move_uci: str, depth: int = 12) -> Dict[str, Any]:
        """
        Analyze a specific move and return its evaluation.
        Used for getting engine eval of history-only moves not in top N.
        
        Returns dict with:
        - score_cp: Centipawn score from side to move perspective
        - score_mate: Mate in N (if applicable)
        """
        if not self.engine:
            return {"score_cp": -100}  # Default penalty if no engine
        
        try:
            board = chess.Board(fen)
            move = chess.Move.from_uci(move_uci)
            
            if move not in board.legal_moves:
                return {"score_cp": -100}
            
            board.push(move)
            
            # Analyze the position after the move
            analysis = self.engine.analyse(
                board,
                chess.engine.Limit(depth=depth),
                multipv=1
            )
            
            if analysis and "score" in analysis[0]:
                score = analysis[0]["score"].relative
                if score.is_mate():
                    # Negate because we're looking from opponent's view
                    mate_score = -10000 if score.mate() > 0 else 10000
                    return {"score_cp": mate_score, "score_mate": -score.mate()}
                else:
                    return {"score_cp": -score.score()}  # Negate to get original side's perspective
            
            return {"score_cp": -100}
            
        except Exception as e:
            print(f"Single move analysis error: {e}")
            return {"score_cp": -100}
    
    def close(self):
        """Shut down the engine."""
        if self.engine:
            self.engine.quit()
            self.engine = None
