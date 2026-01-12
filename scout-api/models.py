"""
Pydantic models for Scout API request/response schemas.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class PredictionMode(str, Enum):
    """Prediction mode selection."""
    PURE_HISTORY = "pure_history"
    HYBRID = "hybrid"


class StyleMarkers(BaseModel):
    """Opponent style markers (pre-computed from historical games)."""
    aggression_index: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = more aggressive")
    queen_trade_avoidance: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = avoids trades")
    material_greed: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = takes material even if risky")
    complexity_preference: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = prefers complex positions")
    space_expansion: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = prefers space/pawn pushes")
    blunder_rate: float = Field(default=5.0, ge=0, le=100, description="Percentage of moves that are blunders")
    time_pressure_weakness: float = Field(default=50.0, ge=0, le=100, description="0-100, higher = worse under time pressure")


class HistoryMove(BaseModel):
    """A historical move from the opponent's game database."""
    move_san: str
    frequency: int = Field(description="How many times this move was played")
    last_played: Optional[str] = Field(default=None, description="ISO date of most recent game")
    avg_result: Optional[float] = Field(default=None, description="Average result: 1=win, 0.5=draw, 0=loss")


class PredictionRequest(BaseModel):
    """Request body for move prediction."""
    fen: str = Field(description="Current board position in FEN notation")
    mode: PredictionMode = Field(default=PredictionMode.HYBRID, description="Prediction mode")
    opponent_username: str = Field(description="Opponent username for context")
    is_opponent_turn: bool = Field(default=True, description="Whether it is currently the opponent's turn to move")
    style_markers: StyleMarkers = Field(default_factory=StyleMarkers, description="Opponent style profile")
    history_moves: List[HistoryMove] = Field(default_factory=list, description="Historical moves at this position")
    recent_eval_deltas: List[float] = Field(default_factory=list, description="Eval changes of last 3 moves (for tilt detection)")
    move_number: int = Field(default=1, ge=1, description="Current move number (for phase detection)")


class MoveAttribution(BaseModel):
    """Breakdown of why a move was scored a certain way."""
    aggression_bonus: float = Field(default=0.0, description="Bonus from aggression alignment")
    complexity_bonus: float = Field(default=0.0, description="Bonus from complexity preference")
    trade_penalty: float = Field(default=0.0, description="Penalty for trade offers")
    greed_bonus: float = Field(default=0.0, description="Bonus from material greed")
    space_bonus: float = Field(default=0.0, description="Bonus from space expansion")
    tilt_modifier: float = Field(default=0.0, description="Modifier from tilt state")


class CandidateMove(BaseModel):
    """A candidate move with full attribution."""
    move: str = Field(description="Move in SAN notation")
    move_uci: str = Field(description="Move in UCI notation")
    engine_eval: float = Field(description="Engine evaluation (centipawns)")
    engine_rank: int = Field(description="Engine ranking (1 = best)")
    history_frequency: float = Field(default=0.0, description="Historical frequency (0-1)")
    style_fit: float = Field(default=0.0, description="Style fit score")
    raw_score: float = Field(description="Raw weighted score before softmax")
    final_prob: float = Field(description="Final probability (0-100)")
    attribution: MoveAttribution = Field(default_factory=MoveAttribution)
    reason: str = Field(default="", description="Human-readable explanation")


class PhaseWeights(BaseModel):
    """Current phase weights being applied."""
    phase: str = Field(description="opening, middlegame, or endgame")
    history: float = Field(description="Alpha weight for history")
    engine: float = Field(description="Beta weight for engine")
    style: float = Field(description="Gamma weight for style")
    predictability_index: float = Field(default=0.0, description="PI = sum of squared frequencies (0-1)")
    sample_size: int = Field(default=0, description="N = total games in position history")
    weight_mode: str = Field(default="phase", description="'habit' (PI>0.85), 'chameleon' (PI<0.40), 'phase' (default)")


class TraceLogEntry(BaseModel):
    """A single entry in the logic trace log."""
    type: str = Field(description="logic, warning, decision, tilt")
    message: str


class HabitDetection(BaseModel):
    """Habit detection result for the '95% Move' feature."""
    detected: bool = Field(default=False, description="True if a dominant habit move exists")
    move: Optional[str] = Field(default=None, description="The habit move in SAN")
    frequency: float = Field(default=0.0, description="Frequency percentage (0-100)")
    sample_size: int = Field(default=0, description="Number of games in sample")


class MoveSourceAttribution(BaseModel):
    """Attribution of where move prediction came from."""
    primary_source: str = Field(default="engine", description="'history', 'style', or 'engine'")
    history_contribution: float = Field(default=0.0, description="Percentage from history (0-100)")
    style_contribution: float = Field(default=0.0, description="Percentage from style (0-100)")
    engine_contribution: float = Field(default=0.0, description="Percentage from engine (0-100)")


class TacticalGuardrail(BaseModel):
    """Tactical Guardrail result for forced tactics detection."""
    triggered: bool = Field(default=False, description="True if guardrail overrode style weights")
    eval_delta: float = Field(default=0.0, description="Centipawn gap between M1 and M2")
    is_forcing: bool = Field(default=False, description="True if M1 is check/capture/queen threat")
    reason: str = Field(default="", description="Explanation of why guardrail triggered")


class PredictionResponse(BaseModel):
    """Response from the prediction endpoint."""
    prediction_mode: PredictionMode
    selected_move: str = Field(description="The chosen move in SAN")
    selected_move_uci: str = Field(description="The chosen move in UCI")
    weights: PhaseWeights
    candidates: List[CandidateMove]
    trace_log: List[TraceLogEntry] = Field(default_factory=list)
    tilt_active: bool = Field(default=False, description="Whether opponent is in tilt state")
    blunder_applied: bool = Field(default=False, description="Whether blunder simulation was applied")
    habit_detection: HabitDetection = Field(default_factory=HabitDetection, description="Habit detection result")
    move_source: MoveSourceAttribution = Field(default_factory=MoveSourceAttribution, description="Primary source attribution")
    suggested_delay_ms: int = Field(default=1500, description="Suggested delay before playing move (ms)")
    tactical_guardrail: TacticalGuardrail = Field(default_factory=TacticalGuardrail, description="Tactical guardrail result")
