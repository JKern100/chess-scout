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
    PhaseWeights, TraceLogEntry, HabitDetection, MoveSourceAttribution
)
from engine import EngineWrapper
from heuristics import ChessHeuristics


class ScoutPredictor:
    """
    Main prediction engine that combines history, engine analysis, and style markers.
    """
    
    # Phase weight configurations (fallback when PI-based weighting doesn't apply)
    PHASE_WEIGHTS = {
        "opening": {"history": 0.7, "engine": 0.1, "style": 0.2},
        "middlegame": {"history": 0.1, "engine": 0.4, "style": 0.5},
        "endgame": {"history": 0.05, "engine": 0.8, "style": 0.15},
    }

    # When it is not the opponent's turn (planning / your-move context), we disable
    # style and focus on history vs engine.
    NON_OPP_TURN_WEIGHTS = {
        "opening": {"history": 0.8, "engine": 0.2, "style": 0.0},
        "middlegame": {"history": 0.3, "engine": 0.7, "style": 0.0},
        "endgame": {"history": 0.3, "engine": 0.7, "style": 0.0},
    }
    
    # PI-based weight configurations
    # "95% Move" - High predictability, history dominates
    HABIT_WEIGHTS = {"history": 0.90, "engine": 0.05, "style": 0.05}
    # "Chameleon" - Low predictability, style dominates
    CHAMELEON_WEIGHTS = {"history": 0.20, "engine": 0.20, "style": 0.60}
    # Low sample fallback - ignore history
    LOW_SAMPLE_WEIGHTS = {"history": 0.0, "engine": 0.30, "style": 0.70}
    
    # Thresholds
    MIN_SAMPLE_SIZE = 5  # N < 5 means ignore history
    HABIT_PI_THRESHOLD = 0.85  # PI > 0.85 = "95% Move"
    CHAMELEON_PI_THRESHOLD = 0.40  # PI < 0.40 = "Chameleon"
    HABIT_DISPLAY_THRESHOLD = 0.90  # Display habit banner if frequency > 90%
    HABIT_MIN_SAMPLE = 10  # Minimum N for habit banner
    
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
    
    def _calculate_pi(self, history_moves: List[HistoryMove]) -> Tuple[float, int]:
        """
        Calculate the Predictability Index (PI) for a position.
        PI = sum of squared frequencies (normalized).
        
        Returns (PI value 0-1, sample size N)
        """
        if not history_moves:
            return 0.0, 0
        
        total = sum(hm.frequency for hm in history_moves)
        if total == 0:
            return 0.0, 0
        
        # PI = sum of (p_i)^2 where p_i is the normalized frequency
        pi = sum((hm.frequency / total) ** 2 for hm in history_moves)
        return pi, total
    
    def _detect_habit(self, history_moves: List[HistoryMove]) -> HabitDetection:
        """
        Detect if there's a dominant "habit" move (>90% frequency with N>10).
        """
        if not history_moves:
            return HabitDetection()
        
        total = sum(hm.frequency for hm in history_moves)
        if total < self.HABIT_MIN_SAMPLE:
            return HabitDetection(sample_size=total)
        
        # Find highest frequency move
        sorted_moves = sorted(history_moves, key=lambda x: x.frequency, reverse=True)
        top_move = sorted_moves[0]
        freq_pct = (top_move.frequency / total) * 100
        
        if freq_pct >= self.HABIT_DISPLAY_THRESHOLD * 100:
            return HabitDetection(
                detected=True,
                move=top_move.move_san,
                frequency=freq_pct,
                sample_size=total
            )
        
        return HabitDetection(sample_size=total)
    
    def _get_dynamic_weights(
        self, 
        move_number: int, 
        history_moves: List[HistoryMove],
        is_opponent_turn: bool = True,
    ) -> Tuple[PhaseWeights, str]:
        """
        Get weights using dynamic PI-based logic.
        
        Returns (PhaseWeights, weight_mode)
        """
        phase = self._determine_phase(move_number)

        # If it is not the opponent's turn, disable style and use deterministic
        # phase weights focused on book (opening) vs accuracy (mid/end).
        if not is_opponent_turn:
            weights = self.NON_OPP_TURN_WEIGHTS[phase]
            return PhaseWeights(
                phase=phase,
                history=weights["history"],
                engine=weights["engine"],
                style=weights["style"],
                predictability_index=0.0,
                sample_size=sum(hm.frequency for hm in history_moves) if history_moves else 0,
                weight_mode="non_opponent_turn",
            ), "non_opponent_turn"
        pi, sample_size = self._calculate_pi(history_moves)
        
        # Phase 1: Confidence threshold - if N < 5, ignore history
        if sample_size < self.MIN_SAMPLE_SIZE:
            weights = self.LOW_SAMPLE_WEIGHTS
            weight_mode = "low_sample"
        # Phase 2: PI-based weighting
        elif pi > self.HABIT_PI_THRESHOLD:
            # "95% Move" - high predictability, history dominates
            weights = self.HABIT_WEIGHTS
            weight_mode = "habit"
        elif pi < self.CHAMELEON_PI_THRESHOLD:
            # "Chameleon" - low predictability, style dominates
            weights = self.CHAMELEON_WEIGHTS
            weight_mode = "chameleon"
        else:
            # Standard phase-based weighting
            weights = self.PHASE_WEIGHTS[phase]
            weight_mode = "phase"
        
        return PhaseWeights(
            phase=phase,
            history=weights["history"],
            engine=weights["engine"],
            style=weights["style"],
            predictability_index=pi,
            sample_size=sample_size,
            weight_mode=weight_mode
        ), weight_mode
    
    def _get_phase_weights(self, move_number: int) -> PhaseWeights:
        """Get the alpha, beta, gamma weights for the current phase (legacy method)."""
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
        move_number: int,
        is_opponent_turn: bool = True,
    ) -> PredictionResponse:
        """
        Main prediction method.
        
        Pure History Mode: Sequential fallback (history -> engine)
        Hybrid Mode: Weighted softmax of history, engine, and style
        """
        trace_log: List[TraceLogEntry] = []
        board = chess.Board(fen)
        
        # Get dynamic weights based on PI
        weights, weight_mode = self._get_dynamic_weights(move_number, history_moves, is_opponent_turn)
        
        # Detect habit moves
        habit_detection = self._detect_habit(history_moves)
        
        trace_log.append(TraceLogEntry(
            type="logic",
            message=f"Phase: {weights.phase} (α={weights.history:.2f}, β={weights.engine:.2f}, γ={weights.style:.2f})"
        ))
        trace_log.append(TraceLogEntry(
            type="logic",
            message=f"PI={weights.predictability_index:.2f}, N={weights.sample_size}, Mode={weight_mode}"
        ))
        
        if habit_detection.detected:
            trace_log.append(TraceLogEntry(
                type="decision",
                message=f"HABIT: {habit_detection.move} played {habit_detection.frequency:.0f}% of the time (N={habit_detection.sample_size})"
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
                board, engine_analysis, history_moves, weights, trace_log, tilt_active, habit_detection
            )
        
        # Hybrid Mode
        return self._predict_hybrid(
            board, engine_analysis, history_moves, working_markers,
            weights, trace_log, tilt_active, move_number, habit_detection
        )
    
    def _predict_pure_history(
        self,
        board: chess.Board,
        engine_analysis: List[Dict[str, Any]],
        history_moves: List[HistoryMove],
        weights: PhaseWeights,
        trace_log: List[TraceLogEntry],
        tilt_active: bool,
        habit_detection: HabitDetection
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
        
        # Determine move source attribution
        move_source = MoveSourceAttribution(
            primary_source="history" if history_moves else "engine",
            history_contribution=100.0 if history_moves else 0.0,
            style_contribution=0.0,
            engine_contribution=0.0 if history_moves else 100.0
        )
        
        # Suggest fast move timing for habit moves
        suggested_delay = 500 if habit_detection.detected and habit_detection.move == selected_move else 1500
        
        return PredictionResponse(
            prediction_mode=PredictionMode.PURE_HISTORY,
            selected_move=selected_move,
            selected_move_uci=selected_uci,
            weights=weights,
            candidates=candidates,
            trace_log=trace_log,
            tilt_active=tilt_active,
            blunder_applied=False,
            habit_detection=habit_detection,
            move_source=move_source,
            suggested_delay_ms=suggested_delay
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
        move_number: int,
        habit_detection: HabitDetection
    ) -> PredictionResponse:
        """Hybrid mode: Weighted softmax of history, engine, and style."""
        
        # Start with engine's top moves
        candidate_sans = [ea["move_san"] for ea in engine_analysis]
        engine_analysis_map = {ea["move_san"]: ea for ea in engine_analysis}
        
        # CRITICAL FIX: Add high-frequency historical moves that aren't in engine's top picks
        # This ensures moves like Nc6 (99% frequency) aren't excluded just because
        # Stockfish prefers other moves
        total_history_freq = sum(hm.frequency for hm in history_moves) if history_moves else 0
        history_additions = []
        
        for hm in history_moves:
            if hm.move_san not in candidate_sans:
                # Include if frequency is significant (>10% of games OR >5 games)
                freq_pct = (hm.frequency / total_history_freq * 100) if total_history_freq > 0 else 0
                if freq_pct >= 10 or hm.frequency >= 5:
                    # Validate move is legal
                    try:
                        move = board.parse_san(hm.move_san)
                        if move in board.legal_moves:
                            candidate_sans.append(hm.move_san)
                            # Get engine eval for this move
                            eval_info = self.engine.analyze_single_move(board.fen(), move.uci())
                            history_additions.append({
                                "move_san": hm.move_san,
                                "move_uci": move.uci(),
                                "score_cp": eval_info.get("score_cp", -100),  # Default penalty if no eval
                                "rank": len(engine_analysis) + len(history_additions) + 1,
                                "from_history": True
                            })
                            trace_log.append(TraceLogEntry(
                                type="logic",
                                message=f"Added {hm.move_san} from history ({freq_pct:.0f}% freq, {hm.frequency} games)"
                            ))
                    except Exception:
                        pass
        
        # Merge history additions into engine analysis for processing
        extended_analysis = list(engine_analysis) + history_additions
        
        # Normalize inputs with the expanded candidate list
        history_scores = self._normalize_history(history_moves, candidate_sans)
        engine_scores = self._normalize_engine_evals(extended_analysis)
        
        # Calculate style fit for each move (including history additions)
        style_scores = {}
        attributions = {}
        
        for ea in extended_analysis:
            move_san = ea["move_san"]
            try:
                move = board.parse_san(move_san)
                style_fit, attribution = ChessHeuristics.calculate_style_fit(
                    board, move, markers
                )
                style_scores[move_san] = style_fit
                attributions[move_san] = attribution
                
                # Log significant style impacts (only for original engine moves to avoid spam)
                if not ea.get("from_history"):
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
        
        for ea in extended_analysis:
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
        
        # Calculate move source attribution based on weights
        move_source = MoveSourceAttribution(
            primary_source="history" if weights.history >= max(weights.style, weights.engine) else 
                          ("style" if weights.style >= weights.engine else "engine"),
            history_contribution=weights.history * 100,
            style_contribution=weights.style * 100,
            engine_contribution=weights.engine * 100
        )
        
        # Suggest fast move timing for habit moves
        suggested_delay = 500 if habit_detection.detected and habit_detection.move == selected.move else 1500
        
        return PredictionResponse(
            prediction_mode=PredictionMode.HYBRID,
            selected_move=selected.move,
            selected_move_uci=selected.move_uci,
            weights=weights,
            candidates=final_candidates,
            trace_log=trace_log,
            tilt_active=tilt_active,
            blunder_applied=blunder_applied,
            habit_detection=habit_detection,
            move_source=move_source,
            suggested_delay_ms=suggested_delay
        )
