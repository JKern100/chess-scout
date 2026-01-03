# Scout API

Style-Weighted Move Prediction Engine for Chess Scout.

## Overview

FastAPI microservice that provides hybrid move prediction combining:
- **Historical game data** (opponent's past moves at this position)
- **Engine analysis** (Stockfish Multi-PV 5 at depth 18-20)
- **Style markers** (aggression, trade avoidance, material greed, etc.)

## Setup

### Prerequisites

- Python 3.10+
- Stockfish chess engine installed and accessible

### Installation

```bash
cd scout-api
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac

pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file:

```env
STOCKFISH_PATH=stockfish  # or full path like C:\stockfish\stockfish.exe
DATABASE_URL=postgresql://user:pass@localhost:5432/chess_scout
```

### Running

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## API Endpoints

### `GET /health`
Health check endpoint.

### `POST /predict`
Main prediction endpoint.

Request body:
```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "mode": "hybrid",
  "opponent_username": "opponent123",
  "style_markers": {
    "aggression_index": 75,
    "queen_trade_avoidance": 85,
    "material_greed": 60,
    "complexity_preference": 70,
    "space_expansion": 55,
    "blunder_rate": 8,
    "time_pressure_weakness": 40
  },
  "history_moves": [
    {"move_san": "e5", "frequency": 45},
    {"move_san": "c5", "frequency": 30},
    {"move_san": "e6", "frequency": 15}
  ],
  "recent_eval_deltas": [-0.5, 0.2, -1.5],
  "move_number": 1
}
```

Response:
```json
{
  "prediction_mode": "hybrid",
  "selected_move": "e5",
  "selected_move_uci": "e7e5",
  "weights": {
    "phase": "opening",
    "history": 0.7,
    "engine": 0.1,
    "style": 0.2
  },
  "candidates": [...],
  "trace_log": [...],
  "tilt_active": false,
  "blunder_applied": false
}
```

### `POST /analyze`
Raw engine analysis endpoint.

## Prediction Modes

### Pure History
Sequential fallback: history → engine.
Uses the most frequent historical move if available, otherwise engine's top choice.

### Hybrid (Scout)
Weighted softmax combining all factors:

$$P(m) = \text{Softmax}(\alpha \cdot H_m + \beta \cdot E_m + \gamma \cdot S_m)$$

Phase-based weights:
- **Opening (1-12)**: α=0.7, β=0.1, γ=0.2
- **Middlegame (13-35)**: α=0.1, β=0.4, γ=0.5
- **Endgame (35+)**: α=0.05, β=0.8, γ=0.15

## Style Markers

| Marker | Description | Impact |
|--------|-------------|--------|
| aggression_index | Tendency to attack | Boosts checks, threats, king pressure |
| queen_trade_avoidance | Reluctance to trade queens | Heavy penalty for trade offers |
| material_greed | Takes risky material | Boosts "poisoned pawn" captures |
| complexity_preference | Likes messy positions | Boosts high-tension moves |
| space_expansion | Likes pawn pushes | Boosts space-gaining moves |
| blunder_rate | Historical blunder % | Enables blunder simulation |

## Psychological Simulation

### Tilt Detection
Monitors recent eval deltas. If opponent blundered (>1.0 drop), doubles aggression and halves accuracy for 3 plies.

### Blunder Simulation
When blunder_rate is high and board tension is high, intentionally selects 3rd or 4th best move to simulate tactical blindness.
