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
from database import db, get_db

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
    """Initialize the predictor with Stockfish and database on startup."""
    global predictor
    stockfish_path = os.getenv("STOCKFISH_PATH", "stockfish")
    predictor = ScoutPredictor(stockfish_path=stockfish_path)
    print(f"Scout API initialized with Stockfish at: {stockfish_path}")
    
    # Initialize database connection
    await db.connect()


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up resources on shutdown."""
    global predictor
    if predictor:
        predictor.close()
    await db.close()


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


@app.post("/analyze")
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


@app.get("/markers/{platform}/{username}")
async def get_style_markers(platform: str, username: str):
    """
    Fetch pre-computed style markers for an opponent from the database.
    """
    markers = await db.fetch_style_markers(platform, username)
    if not markers:
        return {"found": False, "markers": None}
    return {"found": True, "markers": markers}


@app.get("/history/{platform}/{username}")
async def get_opponent_history(platform: str, username: str, fen: str):
    """
    Fetch historical moves for an opponent at a given position.
    """
    history = await db.fetch_opponent_history(platform, username, fen)
    return {"moves": history}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
