"""
Database connection module for Scout API.
Connects to Supabase/PostgreSQL to fetch opponent style markers.
"""

import os
import asyncio
from typing import Optional, Dict, Any, List
import asyncpg
from dotenv import load_dotenv

load_dotenv()


class Database:
    """Async database connection manager."""
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self._connection_string = os.getenv("DATABASE_URL", "")
    
    async def connect(self):
        """Initialize the connection pool."""
        if not self._connection_string:
            print("Warning: DATABASE_URL not set. Database features disabled.")
            return
        
        try:
            self.pool = await asyncpg.create_pool(
                self._connection_string,
                min_size=1,
                max_size=5,
                command_timeout=30
            )
            print("Database connection pool initialized.")
        except Exception as e:
            print(f"Warning: Could not connect to database: {e}")
            self.pool = None
    
    async def close(self):
        """Close the connection pool."""
        if self.pool:
            await self.pool.close()
            self.pool = None
    
    async def fetch_style_markers(
        self,
        platform: str,
        username: str
    ) -> Optional[Dict[str, float]]:
        """
        Fetch pre-computed style markers for an opponent.
        
        Returns a dict with marker values (0-100 scale) or None if not found.
        """
        if not self.pool:
            return None
        
        try:
            # Query the opponents table for style markers
            row = await self.pool.fetchrow(
                """
                SELECT style_markers
                FROM opponents
                WHERE platform = $1 AND LOWER(username) = LOWER($2)
                """,
                platform,
                username
            )
            
            if not row or not row["style_markers"]:
                return None
            
            markers = row["style_markers"]
            
            # Convert stored markers to the format expected by the predictor
            result = {
                "aggression_index": 50.0,
                "queen_trade_avoidance": 50.0,
                "material_greed": 50.0,
                "complexity_preference": 50.0,
                "space_expansion": 50.0,
                "blunder_rate": 5.0,
                "time_pressure_weakness": 50.0,
            }
            
            # Map stored markers to predictor format
            if isinstance(markers, list):
                for marker in markers:
                    key = marker.get("marker_key", "")
                    metrics = marker.get("metrics_json", {})
                    
                    # Map specific markers
                    if key == "aggression":
                        result["aggression_index"] = float(metrics.get("value", 50))
                    elif key == "queen_trade":
                        result["queen_trade_avoidance"] = float(metrics.get("avoidance_rate", 50))
                    elif key == "material":
                        result["material_greed"] = float(metrics.get("greed_score", 50))
                    elif key == "complexity":
                        result["complexity_preference"] = float(metrics.get("preference", 50))
                    elif key == "space":
                        result["space_expansion"] = float(metrics.get("expansion_rate", 50))
                    elif key == "accuracy":
                        # Derive blunder rate from accuracy
                        accuracy = float(metrics.get("value", 95))
                        result["blunder_rate"] = max(0, min(100, 100 - accuracy))
            
            return result
            
        except Exception as e:
            print(f"Error fetching style markers: {e}")
            return None
    
    async def fetch_opponent_history(
        self,
        platform: str,
        username: str,
        fen: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Fetch historical moves for an opponent at a given position.
        
        Returns list of {move_san, frequency, last_played, avg_result}.
        """
        if not self.pool:
            return []
        
        try:
            # Query the game_positions or similar table
            # This depends on how position data is stored
            rows = await self.pool.fetch(
                """
                SELECT 
                    move_san,
                    COUNT(*) as frequency,
                    MAX(played_at) as last_played,
                    AVG(CASE 
                        WHEN result = 'win' THEN 1.0 
                        WHEN result = 'draw' THEN 0.5 
                        ELSE 0.0 
                    END) as avg_result
                FROM game_moves gm
                JOIN games g ON g.id = gm.game_id
                WHERE g.platform = $1 
                  AND LOWER(g.opponent_username) = LOWER($2)
                  AND gm.fen = $3
                GROUP BY move_san
                ORDER BY frequency DESC
                LIMIT $4
                """,
                platform,
                username,
                fen,
                limit
            )
            
            return [
                {
                    "move_san": row["move_san"],
                    "frequency": row["frequency"],
                    "last_played": str(row["last_played"]) if row["last_played"] else None,
                    "avg_result": float(row["avg_result"]) if row["avg_result"] else None,
                }
                for row in rows
            ]
            
        except Exception as e:
            print(f"Error fetching opponent history: {e}")
            return []


# Singleton instance
db = Database()


async def get_db() -> Database:
    """Get the database instance."""
    return db
