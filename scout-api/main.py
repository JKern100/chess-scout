"""
Scout API - Style-Weighted Move Prediction Engine
FastAPI microservice for chess move prediction using hybrid analysis.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
from dotenv import load_dotenv

from predictor import ScoutPredictor
from models import PredictionRequest, PredictionResponse, PredictionMode, StyleMarkers
from heuristics import ChessHeuristics
# from database import db, get_db  # Disabled for now

load_dotenv()

app = FastAPI(
    title="Scout API",
    description="Style-Weighted Move Prediction Engine for Chess Scout",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global predictor instance
predictor: Optional[ScoutPredictor] = None


@app.on_event("startup")
async def startup_event():
    """Initialize the predictor with Stockfish on startup."""
    global predictor
    stockfish_path = os.getenv("STOCKFISH_PATH", "stockfish")
    predictor = ScoutPredictor(stockfish_path=stockfish_path)
    print(f"Scout API initialized with Stockfish at: {stockfish_path}")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up resources on shutdown."""
    global predictor
    if predictor:
        predictor.close()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "engine_ready": predictor is not None}


@app.post("/predict", response_model=PredictionResponse)
async def predict_move(request: PredictionRequest) -> PredictionResponse:
    """
    Predict the next move for an opponent based on FEN, history, and style markers.
    
    Supports two modes:
    - "pure_history": Sequential fallback (history -> engine)
    - "hybrid": Weighted softmax of history, engine, and style
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Predictor not initialized")
    
    try:
        result = predictor.predict(
            fen=request.fen,
            mode=request.mode,
            opponent_username=request.opponent_username,
            style_markers=request.style_markers,
            history_moves=request.history_moves,
            recent_eval_deltas=request.recent_eval_deltas,
            move_number=request.move_number
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/analyze")
async def analyze_position(fen: str, depth: int = 18, multipv: int = 5):
    """
    Get raw engine analysis for a position.
    Returns top N moves with evaluations.
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Predictor not initialized")
    
    try:
        analysis = predictor.engine.analyze_position(fen, depth=depth, multipv=multipv)
        return {"fen": fen, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Database endpoints disabled for now
# @app.get("/markers/{platform}/{username}")
# async def get_style_markers(platform: str, username: str):
#     """
#     Fetch pre-computed style markers for an opponent from the database.
#     """
#     markers = await db.fetch_style_markers(platform, username)
#     if not markers:
#         return {"found": False, "markers": None}
#     return {"found": True, "markers": markers}


# @app.get("/history/{platform}/{username}")
# async def get_opponent_history(platform: str, username: str, fen: str):
#     """
#     Fetch historical moves for an opponent at a given position.
#     """
#     history = await db.fetch_opponent_history(platform, username, fen)
#     return {"moves": history}


@app.post("/analyze_moves")
async def analyze_moves_with_style(request: dict):
    """
    Analyze a list of moves with style-adjusted evaluations.
    Returns engine evals + style impact for each move.
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Predictor not initialized")
    
    try:
        fen = request["fen"]
        moves = request["moves"]  # List of UCI moves
        style_markers = request.get("style_markers", {})
        opponent_username = request.get("opponent_username", "unknown")
        
        # Convert to StyleMarkers object
        from models import StyleMarkers
        markers = StyleMarkers(**style_markers)
        
        # Get engine analysis for all moves
        engine_analysis = predictor.engine.analyze_position(fen, depth=15, multipv=len(moves))
        
        # Create a map of move to engine data
        engine_map = {ea["move_uci"]: ea for ea in engine_analysis}
        
        results = []
        import chess
        board = chess.Board(fen)
        
        for move_uci in moves:
            # Get engine evaluation
            engine_data = engine_map.get(move_uci)
            engine_eval = engine_data["score_cp"] / 100 if engine_data else 0
            
            # Calculate style impact
            try:
                move = board.parse_uci(move_uci)
                style_fit, attribution = ChessHeuristics.calculate_style_fit(board, move, markers)
                
                # Calculate style-adjusted evaluation
                # Positive style_fit = good for this player's style, so boost the eval
                style_adjustment = style_fit * 2  # Scale factor for visibility
                adjusted_eval = engine_eval + style_adjustment
                
                # Determine impact badges
                badges = []
                if attribution.aggression_bonus > 0:
                    badges.append({"type": "aggression", "value": "+" + str(int(attribution.aggression_bonus * 100)) + "%", "color": "red"})
                if attribution.trade_penalty < 0:
                    badges.append({"type": "trade", "value": str(int(attribution.trade_penalty * 100)) + "%", "color": "orange"})
                if attribution.greed_bonus > 0:
                    badges.append({"type": "greed", "value": "+" + str(int(attribution.greed_bonus * 100)) + "%", "color": "yellow"})
                if attribution.complexity_bonus > 0:
                    badges.append({"type": "complexity", "value": "+" + str(int(attribution.complexity_bonus * 100)) + "%", "color": "purple"})
                if attribution.space_bonus > 0:
                    badges.append({"type": "space", "value": "+" + str(int(attribution.space_bonus * 100)) + "%", "color": "blue"})
                
            except:
                style_fit = 0
                attribution = {"aggression_bonus": 0, "complexity_bonus": 0, "trade_penalty": 0, "greed_bonus": 0, "space_bonus": 0, "tilt_modifier": 0}
                style_adjustment = 0
                adjusted_eval = engine_eval
                badges = []
            
            results.append({
                "move_uci": move_uci,
                "engine_eval": engine_eval,
                "style_fit": style_fit,
                "style_adjustment": style_adjustment,
                "adjusted_eval": adjusted_eval,
                "badges": badges,
                "attribution": attribution
            })
        
        return {
            "fen": fen,
            "moves": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
