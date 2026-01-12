"""
Chess heuristics for style-based move evaluation.
Uses python-chess for position analysis without calling the engine.
"""

import chess
from typing import Dict, Any, List, Tuple, Optional
from models import StyleMarkers, MoveAttribution


class ChessHeuristics:
    """Heuristic feature detectors for style-based move scoring."""
    
    # King zone: squares around the king (3x3 grid)
    KING_ZONE_OFFSETS = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]
    
    @staticmethod
    def get_king_zone(board: chess.Board, color: chess.Color) -> List[chess.Square]:
        """Get the 3x3 zone around the king of the given color."""
        king_sq = board.king(color)
        if king_sq is None:
            return []
        
        king_file = chess.square_file(king_sq)
        king_rank = chess.square_rank(king_sq)
        
        zone = [king_sq]
        for df, dr in ChessHeuristics.KING_ZONE_OFFSETS:
            new_file = king_file + df
            new_rank = king_rank + dr
            if 0 <= new_file <= 7 and 0 <= new_rank <= 7:
                zone.append(chess.square(new_file, new_rank))
        
        return zone
    
    @staticmethod
    def count_king_zone_pressure(board: chess.Board, attacking_color: chess.Color) -> int:
        """
        Count the number of pieces attacking the enemy king zone.
        Higher = more pressure on the king.
        """
        enemy_color = not attacking_color
        king_zone = ChessHeuristics.get_king_zone(board, enemy_color)
        
        pressure = 0
        for sq in king_zone:
            attackers = board.attackers(attacking_color, sq)
            pressure += len(attackers)
        
        return pressure
    
    @staticmethod
    def move_increases_king_pressure(board: chess.Board, move: chess.Move) -> bool:
        """Check if a move increases pressure on the enemy king zone."""
        color = board.color_at(move.from_square)
        if color is None:
            return False
        
        # Measure pressure before
        pressure_before = ChessHeuristics.count_king_zone_pressure(board, color)
        
        # Make the move
        board_copy = board.copy()
        board_copy.push(move)
        
        # Measure pressure after
        pressure_after = ChessHeuristics.count_king_zone_pressure(board_copy, color)
        
        return pressure_after > pressure_before
    
    @staticmethod
    def calculate_board_tension(board: chess.Board) -> int:
        """
        Calculate board tension: sum of legal captures + checks available.
        Higher tension = more tactical complexity.
        """
        tension = 0
        
        for move in board.legal_moves:
            # Count captures
            if board.is_capture(move):
                tension += 1
            # Count checks
            board_copy = board.copy()
            board_copy.push(move)
            if board_copy.is_check():
                tension += 1
        
        return tension
    
    @staticmethod
    def move_increases_tension(board: chess.Board, move: chess.Move) -> Tuple[bool, int]:
        """
        Check if a move increases board tension.
        Returns (increased, delta).
        """
        tension_before = ChessHeuristics.calculate_board_tension(board)
        
        board_copy = board.copy()
        board_copy.push(move)
        
        tension_after = ChessHeuristics.calculate_board_tension(board_copy)
        delta = tension_after - tension_before
        
        return delta > 0, delta
    
    @staticmethod
    def is_queen_trade_offer(board: chess.Board, move: chess.Move) -> bool:
        """
        Check if a move offers or forces a queen exchange.
        True if:
        - Move captures opponent's queen
        - Move puts our queen en prise to their queen
        - Move creates a queen exchange sequence
        """
        # Check if this move captures a queen
        captured = board.piece_at(move.to_square)
        if captured and captured.piece_type == chess.QUEEN:
            return True
        
        # Check if after this move, our queen can be captured by their queen
        board_copy = board.copy()
        moving_piece = board.piece_at(move.from_square)
        board_copy.push(move)
        
        # If we moved our queen, check if it's attacked by their queen
        if moving_piece and moving_piece.piece_type == chess.QUEEN:
            enemy_color = not moving_piece.color
            for sq in board_copy.pieces(chess.QUEEN, enemy_color):
                if move.to_square in board_copy.attacks(sq):
                    return True
        
        return False
    
    @staticmethod
    def is_material_grab(board: chess.Board, move: chess.Move, eval_drop_threshold: float = 1.5) -> bool:
        """
        Check if a move is a "greedy" material grab.
        True if it's a capture that might be risky (poisoned pawn style).
        For now, we detect:
        - Pawn captures on the enemy side of the board
        - Captures that leave the capturing piece undefended
        """
        if not board.is_capture(move):
            return False
        
        captured = board.piece_at(move.to_square)
        moving_piece = board.piece_at(move.from_square)
        
        if not captured or not moving_piece:
            return False
        
        # Check if capturing piece will be undefended
        board_copy = board.copy()
        board_copy.push(move)
        
        # Check if the square is attacked by opponent
        enemy_color = not moving_piece.color
        if board_copy.is_attacked_by(enemy_color, move.to_square):
            # Check if we have enough defenders
            defenders = board_copy.attackers(moving_piece.color, move.to_square)
            attackers = board_copy.attackers(enemy_color, move.to_square)
            if len(attackers) > len(defenders):
                return True
        
        return False
    
    @staticmethod
    def is_space_expansion(board: chess.Board, move: chess.Move) -> bool:
        """
        Check if a move is a space-gaining pawn push.
        True for non-capture pawn moves that advance past the 4th rank.
        """
        moving_piece = board.piece_at(move.from_square)
        if not moving_piece or moving_piece.piece_type != chess.PAWN:
            return False
        
        if board.is_capture(move):
            return False
        
        # Check if pawn is advancing to 5th rank or beyond (for white)
        to_rank = chess.square_rank(move.to_square)
        if moving_piece.color == chess.WHITE:
            return to_rank >= 4  # 5th rank = index 4
        else:
            return to_rank <= 3  # 4th rank from black's perspective
    
    @staticmethod
    def is_check_or_threat(board: chess.Board, move: chess.Move) -> bool:
        """Check if a move gives check or creates a direct threat."""
        board_copy = board.copy()
        board_copy.push(move)
        
        # Check for check
        if board_copy.is_check():
            return True
        
        # Check for threats to high-value pieces (queen, rook)
        moving_piece = board.piece_at(move.from_square)
        if moving_piece:
            enemy_color = not moving_piece.color
            attacks = board_copy.attacks(move.to_square)
            for sq in attacks:
                target = board_copy.piece_at(sq)
                if target and target.color == enemy_color:
                    if target.piece_type in [chess.QUEEN, chess.ROOK]:
                        return True
        
        return False
    
    @staticmethod
    def calculate_style_fit(
        board: chess.Board,
        move: chess.Move,
        markers: StyleMarkers
    ) -> Tuple[float, MoveAttribution]:
        """
        Calculate the style fit score for a move based on opponent's markers.
        Returns (score, attribution breakdown).
        """
        attribution = MoveAttribution()
        total_bonus = 0.0
        
        # Aggression Index
        if markers.aggression_index > 75:
            if ChessHeuristics.is_check_or_threat(board, move):
                bonus = 0.20
                attribution.aggression_bonus = bonus
                total_bonus += bonus
            if ChessHeuristics.move_increases_king_pressure(board, move):
                bonus = 0.15
                attribution.aggression_bonus += bonus
                total_bonus += bonus
        
        # Queen Trade Avoidance
        if markers.queen_trade_avoidance > 80:
            if ChessHeuristics.is_queen_trade_offer(board, move):
                penalty = -0.50
                attribution.trade_penalty = penalty
                total_bonus += penalty
        
        # Material Greed
        if markers.material_greed > 70:
            if ChessHeuristics.is_material_grab(board, move):
                bonus = 0.30
                attribution.greed_bonus = bonus
                total_bonus += bonus
        
        # Complexity Preference
        if markers.complexity_preference > 80:
            increases, delta = ChessHeuristics.move_increases_tension(board, move)
            if increases and delta > 2:
                bonus = 0.25
                attribution.complexity_bonus = bonus
                total_bonus += bonus
        elif markers.complexity_preference < 30:
            # Penalize complex moves for simple players
            increases, delta = ChessHeuristics.move_increases_tension(board, move)
            if increases and delta > 3:
                penalty = -0.15
                attribution.complexity_bonus = penalty
                total_bonus += penalty
        
        # Space Expansion
        if markers.space_expansion > 60:
            if ChessHeuristics.is_space_expansion(board, move):
                bonus = 0.15
                attribution.space_bonus = bonus
                total_bonus += bonus
        
        return total_bonus, attribution
    
    @staticmethod
    def detect_tilt(recent_eval_deltas: List[float], threshold: float = 1.0) -> bool:
        """
        Detect if opponent is in a "tilt" state.
        True if any of the last 3 moves had an eval drop > threshold.
        """
        if not recent_eval_deltas:
            return False
        
        for delta in recent_eval_deltas[-3:]:
            if delta < -threshold:  # Negative delta = blunder
                return True
        
        return False
    
    @staticmethod
    def apply_tilt_modifiers(
        markers: StyleMarkers,
        attribution: MoveAttribution
    ) -> StyleMarkers:
        """
        Apply tilt modifiers to style markers.
        Doubles aggression, halves engine accuracy preference.
        """
        tilted_markers = StyleMarkers(
            aggression_index=min(100, markers.aggression_index * 2),
            queen_trade_avoidance=markers.queen_trade_avoidance,
            material_greed=min(100, markers.material_greed * 1.5),
            complexity_preference=markers.complexity_preference,
            space_expansion=markers.space_expansion,
            blunder_rate=min(100, markers.blunder_rate * 2),
            time_pressure_weakness=markers.time_pressure_weakness
        )
        
        # Track the tilt modifier
        attribution.tilt_modifier = 0.5  # 50% boost to style effects
        
        return tilted_markers
    
    @staticmethod
    def is_forcing_move(board: chess.Board, move: chess.Move) -> bool:
        """
        Check if a move is "forcing" - a check, capture, or immediate queen threat.
        Used by the Tactical Guardrail to detect tactically critical moves.
        """
        # Check if it's a capture
        if board.is_capture(move):
            return True
        
        # Check if it gives check
        board_copy = board.copy()
        board_copy.push(move)
        if board_copy.is_check():
            return True
        
        # Check if it creates a direct threat to the queen
        moving_piece = board.piece_at(move.from_square)
        if moving_piece:
            enemy_color = not moving_piece.color
            attacks = board_copy.attacks(move.to_square)
            for sq in attacks:
                target = board_copy.piece_at(sq)
                if target and target.color == enemy_color and target.piece_type == chess.QUEEN:
                    return True
        
        return False
