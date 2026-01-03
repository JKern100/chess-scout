"""
Scout Predictor - Core prediction engine with hybrid mode support.
Implements the Weighted Softmax formula for style-weighted move prediction.
"""

import chess
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
import random

from models import (
    PredictionMode, StyleMarkers, HistoryMove,
    PredictionResponse, CandidateMove, MoveAttribution,
    PhaseWeights, TraceLogEntry
)
from engine import EngineWrapper
from heuristics import ChessHeuristics


class ScoutPredictor:
    """
    Main prediction engine that combines history, engine analysis, and style markers.
    """
    
    # Phase weight configurations
    PHASE_WEIGHTS = {
        "opening": {"history": 0.7, "engine": 0.1, "style": 0.2},
        "middlegame": {"history": 0.1, "engine": 0.4, "style": 0.5},
        "endgame": {"history": 0.05, "engine": 0.8, "style": 0.15},
    }
    
    def __init__(self, stockfish_path: str = "stockfish"):
        """Initialize the predictor with Stockfish engine."""
        self.engine = EngineWrapper(stockfish_path)
    
    def close(self):
        """Clean up resources."""
        self.engine.close()
    
    def _determine_phase(self, move_number: int) -> str:
        """Determine game phase based on move number."""
        if move_number <= 12:
            return "opening"
        elif move_number <= 35:
            return "middlegame"
        else:
            return "endgame"
    
    def _get_phase_weights(self, move_number: int) -> PhaseWeights:
        """Get the alpha, beta, gamma weights for the current phase."""
        phase = self._determine_phase(move_number)
        weights = self.PHASE_WEIGHTS[phase]
        return PhaseWeights(
            phase=phase,
            history=weights["history"],
            engine=weights["engine"],
            style=weights["style"]
        )
    
    def _normalize_history(
        self,
        history_moves: List[HistoryMove],
        candidate_moves: List[str]
    ) -> Dict[str, float]:
        """
        Normalize history frequencies to 0-1 range for candidate moves.
        Applies recency bias: recent games weighted 2x, old games 0.5x.
        """
        if not history_moves:
            return {m: 0.0 for m in candidate_moves}
        
        # Build frequency map
        freq_map = {}
        total = 0
        for hm in history_moves:
            # Simple recency bias (would need actual dates for full implementation)
            weight = 1.0
            freq_map[hm.move_san] = hm.frequency * weight
            total += hm.frequency * weight
        
        # Normalize
        result = {}
        for move in candidate_moves:
            if move in freq_map and total > 0:
                result[move] = freq_map[move] / total
            else:
                result[move] = 0.0
        
        return result
    
    def _normalize_engine_evals(
        self,
        engine_analysis: List[Dict[str, Any]]
    ) -> Dict[str, float]:
        """
        Normalize engine evaluations.
        E_m = (Eval_move - Eval_best) normalized to 0-1.
        Best move gets 1.0, worst gets 0.0.
        """
        if not engine_analysis:
            return {}
        
        best_score = engine_analysis[0]["score_cp"]
        worst_score = engine_analysis[-1]["score_cp"]
        score_range = best_score - worst_score if best_score != worst_score else 1
        
        result = {}
        for analysis in engine_analysis:
            move = analysis["move_san"]
            score = analysis["score_cp"]
            # Normalize so best = 1.0, worst = 0.0
            normalized = (score - worst_score) / score_range if score_range != 0 else 1.0
            result[move] = normalized
        
        return result
    
    def _softmax(self, scores: List[float], temperature: float = 1.0) -> List[float]:
        """Apply softmax to convert scores to probabilities."""
        scores = np.array(scores) / temperature
        exp_scores = np.exp(scores - np.max(scores))  # Subtract max for numerical stability
        return (exp_scores / exp_scores.sum()).tolist()
    
    def _generate_reason(
        self,
        move: str,
        attribution: MoveAttribution,
        engine_rank: int,
        history_freq: float
    ) -> str:
        """Generate a human-readable reason for the move scoring."""
        reasons = []
        
        if history_freq > 0.3:
            reasons.append(f"frequently played ({int(history_freq * 100)}% of games)")
        
        if attribution.aggression_bonus > 0:
            reasons.append("aligns with aggressive style")
        
        if attribution.complexity_bonus > 0:
            reasons.append("increases position complexity")
        elif attribution.complexity_bonus < 0:
            reasons.append("too complex for opponent's preference")
        
        if attribution.trade_penalty < 0:
            reasons.append("penalized for trade offer (opponent avoids trades)")
        
        if attribution.greed_bonus > 0:
            reasons.append("material grab matches 'Greed' profile")
        
        if attribution.space_bonus > 0:
            reasons.append("space-gaining pawn push")
        
        if engine_rank == 1:
            reasons.append("engine's top choice")
        elif engine_rank <= 3:
            reasons.append(f"engine's #{engine_rank} choice")
        
        if not reasons:
            return "Standard move selection"
        
        return "; ".join(reasons).capitalize() + "."
    
    def _select_blunder_move(
        self,
        candidates: List[CandidateMove],
        blunder_rate: float,
        tension: int
    ) -> Optional[int]:
        """
        Determine if blunder simulation should apply.
        Returns the index of the move to select (3rd or 4th best), or None.
        """
        # High blunder rate + high tension = likely blunder
        blunder_chance = (blunder_rate / 100) * min(1.0, tension / 10)
        
        if random.random() < blunder_chance and len(candidates) >= 4:
            # Pick 3rd or 4th best move
            return random.choice([2, 3])
        
        return None
    
    def predict(
        self,
        fen: str,
        mode: PredictionMode,
        opponent_username: str,
        style_markers: StyleMarkers,
        history_moves: List[HistoryMove],
        recent_eval_deltas: List[float],
        move_number: int
    ) -> PredictionResponse:
        """
        Main prediction method.
        
        Pure History Mode: Sequential fallback (history -> engine)
        Hybrid Mode: Weighted softmax of history, engine, and style
        """
        trace_log: List[TraceLogEntry] = []
        board = chess.Board(fen)
        
        # Get phase weights
        weights = self._get_phase_weights(move_number)
        trace_log.append(TraceLogEntry(
            type="logic",
            message=f"Phase: {weights.phase} (α={weights.history:.2f}, β={weights.engine:.2f}, γ={weights.style:.2f})"
        ))
        
        # Check for tilt state
        tilt_active = ChessHeuristics.detect_tilt(recent_eval_deltas)
        working_markers = style_markers
        if tilt_active:
            trace_log.append(TraceLogEntry(
                type="tilt",
                message="TILT DETECTED: Recent blunders detected. Aggression doubled, accuracy halved."
            ))
            working_markers = ChessHeuristics.apply_tilt_modifiers(
                style_markers,
                MoveAttribution()
            )
        
        # Get engine analysis (Top 5)
        engine_analysis = self.engine.analyze_position(fen, depth=18, multipv=5)
        
        if not engine_analysis:
            # Fallback: no engine available
            trace_log.append(TraceLogEntry(
                type="warning",
                message="Engine unavailable. Using random legal move."
            ))
            legal_moves = list(board.legal_moves)
            if legal_moves:
                move = random.choice(legal_moves)
                return PredictionResponse(
                    prediction_mode=mode,
                    selected_move=board.san(move),
                    selected_move_uci=move.uci(),
                    weights=weights,
                    candidates=[],
                    trace_log=trace_log,
                    tilt_active=tilt_active,
                    blunder_applied=False
                )
            raise ValueError("No legal moves available")
        
        # Log engine analysis
        for ea in engine_analysis[:3]:
            trace_log.append(TraceLogEntry(
                type="logic",
                message=f"Engine: {ea['move_san']} (eval: {ea['score_cp']/100:.2f})"
            ))
        
        candidate_sans = [ea["move_san"] for ea in engine_analysis]
        
        # Pure History Mode
        if mode == PredictionMode.PURE_HISTORY:
            return self._predict_pure_history(
                board, engine_analysis, history_moves, weights, trace_log, tilt_active
            )
        
        # Hybrid Mode
        return self._predict_hybrid(
            board, engine_analysis, history_moves, working_markers,
            weights, trace_log, tilt_active, move_number
        )
    
    def _predict_pure_history(
        self,
        board: chess.Board,
        engine_analysis: List[Dict[str, Any]],
        history_moves: List[HistoryMove],
        weights: PhaseWeights,
        trace_log: List[TraceLogEntry],
        tilt_active: bool
    ) -> PredictionResponse:
        """Pure history mode: Use history if available, fallback to engine."""
        
        # Check if we have history for any of the legal moves
        history_map = {hm.move_san: hm for hm in history_moves}
        
        # Try to find a historical move
        selected_move = None
        selected_uci = None
        
        if history_moves:
            # Sort by frequency
            sorted_history = sorted(history_moves, key=lambda x: x.frequency, reverse=True)
            
            # Validate the move is legal
            for hm in sorted_history:
                try:
                    move = board.parse_san(hm.move_san)
                    if move in board.legal_moves:
                        selected_move = hm.move_san
                        selected_uci = move.uci()
                        trace_log.append(TraceLogEntry(
                            type="decision",
                            message=f"Selected {selected_move} from history (freq: {hm.frequency})"
                        ))
                        break
                except:
                    continue
        
        # Fallback to engine
        if not selected_move:
            selected_move = engine_analysis[0]["move_san"]
            selected_uci = engine_analysis[0]["move_uci"]
            trace_log.append(TraceLogEntry(
                type="decision",
                message=f"No history found. Fallback to engine: {selected_move}"
            ))
        
        # Build candidate list
        candidates = []
        for ea in engine_analysis:
            hm = history_map.get(ea["move_san"])
            candidates.append(CandidateMove(
                move=ea["move_san"],
                move_uci=ea["move_uci"],
                engine_eval=ea["score_cp"] / 100,
                engine_rank=ea["rank"],
                history_frequency=hm.frequency / sum(h.frequency for h in history_moves) if hm and history_moves else 0,
                style_fit=0,
                raw_score=0,
                final_prob=100 if ea["move_san"] == selected_move else 0,
                attribution=MoveAttribution(),
                reason="Selected from history" if ea["move_san"] == selected_move else ""
            ))
        
        return PredictionResponse(
            prediction_mode=PredictionMode.PURE_HISTORY,
            selected_move=selected_move,
            selected_move_uci=selected_uci,
            weights=weights,
            candidates=candidates,
            trace_log=trace_log,
            tilt_active=tilt_active,
            blunder_applied=False
        )
    
    def _predict_hybrid(
        self,
        board: chess.Board,
        engine_analysis: List[Dict[str, Any]],
        history_moves: List[HistoryMove],
        markers: StyleMarkers,
        weights: PhaseWeights,
        trace_log: List[TraceLogEntry],
        tilt_active: bool,
        move_number: int
    ) -> PredictionResponse:
        """Hybrid mode: Weighted softmax of history, engine, and style."""
        
        candidate_sans = [ea["move_san"] for ea in engine_analysis]
        
        # Normalize inputs
        history_scores = self._normalize_history(history_moves, candidate_sans)
        engine_scores = self._normalize_engine_evals(engine_analysis)
        
        # Calculate style fit for each move
        style_scores = {}
        attributions = {}
        
        for ea in engine_analysis:
            move_san = ea["move_san"]
            try:
                move = board.parse_san(move_san)
                style_fit, attribution = ChessHeuristics.calculate_style_fit(
                    board, move, markers
                )
                style_scores[move_san] = style_fit
                attributions[move_san] = attribution
                
                # Log significant style impacts
                if attribution.trade_penalty < 0:
                    trace_log.append(TraceLogEntry(
                        type="warning",
                        message=f"{move_san} penalized {int(-attribution.trade_penalty * 100)}% for trade offer"
                    ))
                if attribution.aggression_bonus > 0:
                    trace_log.append(TraceLogEntry(
                        type="logic",
                        message=f"{move_san} boosted {int(attribution.aggression_bonus * 100)}% for aggression"
                    ))
                    
            except Exception:
                style_scores[move_san] = 0
                attributions[move_san] = MoveAttribution()
        
        # Calculate weighted scores: α*H + β*E + γ*S
        raw_scores = []
        candidates = []
        
        for ea in engine_analysis:
            move_san = ea["move_san"]
            h_score = history_scores.get(move_san, 0)
            e_score = engine_scores.get(move_san, 0)
            s_score = style_scores.get(move_san, 0)
            
            raw = (
                weights.history * h_score +
                weights.engine * e_score +
                weights.style * s_score
            )
            raw_scores.append(raw)
            
            candidates.append({
                "move_san": move_san,
                "move_uci": ea["move_uci"],
                "engine_eval": ea["score_cp"] / 100,
                "engine_rank": ea["rank"],
                "history_freq": h_score,
                "style_fit": s_score,
                "raw_score": raw,
                "attribution": attributions.get(move_san, MoveAttribution())
            })
        
        # Apply softmax
        probabilities = self._softmax(raw_scores, temperature=0.5)
        
        # Build final candidates
        final_candidates = []
        for i, cand in enumerate(candidates):
            prob = probabilities[i] * 100
            final_candidates.append(CandidateMove(
                move=cand["move_san"],
                move_uci=cand["move_uci"],
                engine_eval=cand["engine_eval"],
                engine_rank=cand["engine_rank"],
                history_frequency=cand["history_freq"],
                style_fit=cand["style_fit"],
                raw_score=cand["raw_score"],
                final_prob=prob,
                attribution=cand["attribution"],
                reason=self._generate_reason(
                    cand["move_san"],
                    cand["attribution"],
                    cand["engine_rank"],
                    cand["history_freq"]
                )
            ))
        
        # Sort by probability
        final_candidates.sort(key=lambda x: x.final_prob, reverse=True)
        
        # Check for blunder simulation
        blunder_applied = False
        tension = ChessHeuristics.calculate_board_tension(board)
        blunder_idx = self._select_blunder_move(final_candidates, markers.blunder_rate, tension)
        
        if blunder_idx is not None:
            selected_idx = blunder_idx
            blunder_applied = True
            trace_log.append(TraceLogEntry(
                type="warning",
                message=f"BLUNDER SIMULATION: High tension ({tension}) + blunder rate ({markers.blunder_rate:.0f}%). Selecting #{blunder_idx + 1} choice."
            ))
        else:
            # Select based on probability distribution
            r = random.random() * 100
            cumulative = 0
            selected_idx = 0
            for i, cand in enumerate(final_candidates):
                cumulative += cand.final_prob
                if r <= cumulative:
                    selected_idx = i
                    break
        
        selected = final_candidates[selected_idx]
        
        trace_log.append(TraceLogEntry(
            type="decision",
            message=f"Selected: {selected.move} (prob: {selected.final_prob:.1f}%)"
        ))
        
        return PredictionResponse(
            prediction_mode=PredictionMode.HYBRID,
            selected_move=selected.move,
            selected_move_uci=selected.move_uci,
            weights=weights,
            candidates=final_candidates,
            trace_log=trace_log,
            tilt_active=tilt_active,
            blunder_applied=blunder_applied
        )
