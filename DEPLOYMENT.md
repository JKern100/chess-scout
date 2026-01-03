# Chess Scout - Production Deployment Guide

## Architecture Overview

**Hybrid Cloud Setup:**
- **Backend (Scout API)**: Railway - Python FastAPI with Stockfish
- **Frontend**: Vercel - Next.js application
- **Database**: Supabase - PostgreSQL

## 1. Backend Deployment (Railway)

### Prerequisites
- Railway account
- GitHub repository connected to Railway

### Setup Steps

1. **Create New Railway Project**
   - Go to Railway dashboard
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your chess-scout repository
   - Set **Root Directory**: `scout-api`

2. **Configure Build Settings**
   - Railway will auto-detect the Dockerfile
   - Build command: (automatic via Dockerfile)
   - Start command: (automatic via Dockerfile CMD)

3. **Environment Variables**
   ```bash
   STOCKFISH_PATH=/usr/games/stockfish
   # Optional: DATABASE_URL=postgresql://...
   ```

4. **Deploy**
   - Railway will automatically build and deploy
   - Note your deployment URL: `https://your-app.up.railway.app`

### Dockerfile Details
The `scout-api/Dockerfile` includes:
- Python 3.13 slim base image
- Stockfish installation via apt
- All Python dependencies from requirements.txt
- Exposes port 8001
- Runs uvicorn server

### Testing the Deployment
```bash
# Test engine analysis
curl "https://your-app.up.railway.app/analyze?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR%20w%20KQkq%20-%200%201&depth=15&multipv=3"

# Test prediction endpoint
curl -X POST https://your-app.up.railway.app/predict \
  -H "Content-Type: application/json" \
  -d '{
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "mode": "hybrid",
    "opponent_username": "test",
    "style_markers": {
      "aggression_index": 75,
      "queen_trade_avoidance": 60,
      "material_greed": 70,
      "complexity_preference": 65,
      "space_expansion": 55,
      "blunder_rate": 8,
      "time_pressure_weakness": 50
    },
    "history_moves": [],
    "recent_eval_deltas": [],
    "move_number": 1
  }'
```

## 2. Frontend Deployment (Vercel)

### Prerequisites
- Vercel account
- GitHub repository connected to Vercel

### Setup Steps

1. **Create New Vercel Project**
   - Go to Vercel dashboard
   - Click "Add New..." → "Project"
   - Import your chess-scout repository
   - Framework Preset: Next.js (auto-detected)

2. **Configure Environment Variables**
   ```bash
   # Scout API URL (Railway)
   SCOUT_API_URL=https://your-app.up.railway.app
   
   # Supabase (existing)
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **Build Settings**
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)
   - Install Command: `npm install` (default)

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - Your app will be live at: `https://your-app.vercel.app`

## 3. Local Development Setup

### Option A: Point to Production Scout API
```bash
# .env.local
SCOUT_API_URL=https://your-app.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Option B: Run Everything Locally
```bash
# Frontend (.env.local)
SCOUT_API_URL=http://localhost:8001
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Backend (scout-api/.env)
STOCKFISH_PATH=/usr/local/bin/stockfish  # MacOS
# or
STOCKFISH_PATH=C:\path\to\stockfish.exe  # Windows
```

**Run locally:**
```bash
# Terminal 1: Scout API
cd scout-api
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001

# Terminal 2: Frontend
npm install
npm run dev -- --port 3002
```

## 4. Scout Dashboard Features

### Implemented Features

#### Phase Weights (α, β, γ)
The Scout API dynamically adjusts prediction weights based on game phase:

- **Opening (moves 1-12)**: 
  - α (History) = 0.7
  - β (Engine) = 0.1
  - γ (Style) = 0.2

- **Middlegame (moves 13-35)**:
  - α (History) = 0.1
  - β (Engine) = 0.4
  - γ (Style) = 0.5

- **Endgame (moves 36+)**:
  - α (History) = 0.05
  - β (Engine) = 0.8
  - γ (Style) = 0.15

#### Logic Trace
The Scout Overlay displays real-time attribution data:
- Phase detection and weight distribution
- Tilt detection (recent blunders)
- Style bonuses/penalties per move
- Blunder simulation triggers
- Final move selection reasoning

#### Blunder Simulation (Phase 4)
When conditions are met:
- High `blunder_rate` (>8%)
- High board tension (>7)
- Random chance triggers
- API returns 3rd or 4th best move from Multi-PV 5

### Testing Scout Features

1. **Open Scout Overlay**
   - Click the Brain icon in the simulation toolbar
   - Select "Full Scout" mode (hybrid)

2. **Verify Logic Trace**
   - Check phase detection message
   - Look for style bonuses (aggression, greed, etc.)
   - Verify weight distribution pie chart

3. **Test Blunder Simulation**
   - Set opponent's `blunder_rate` to 15%
   - Navigate to a tense middlegame position
   - Trigger Scout prediction multiple times
   - Occasionally see "BLUNDER SIMULATION" in trace log

## 5. Verification Checklist

### Backend (Railway)
- [ ] Deployment successful
- [ ] `/analyze` endpoint returns engine evaluations
- [ ] `/predict` endpoint returns predictions with trace logs
- [ ] `/analyze_moves` endpoint returns style-adjusted evals
- [ ] Stockfish path correct (`/usr/games/stockfish`)

### Frontend (Vercel)
- [ ] Build successful
- [ ] Environment variables set correctly
- [ ] Scout API proxy routes working (`/api/scout/predict`, `/api/scout/analyze`)
- [ ] No CORS errors in browser console

### Scout Dashboard
- [ ] Brain icon appears in simulation toolbar
- [ ] Scout Overlay opens on click
- [ ] Mode toggle works (History Only / Full Scout)
- [ ] Phase weights display correctly
- [ ] Logic trace shows attribution data
- [ ] Candidate moves list populated
- [ ] Blunder simulation triggers occasionally

### Browser-Side Engine
- [ ] Analysis page engine column works
- [ ] No "split brain" evaluation discrepancies
- [ ] Style-adjusted evaluations display correctly
- [ ] Style badges appear for matching moves

## 6. Troubleshooting

### Railway Issues

**Build fails with Python 3.13 errors:**
- Verify `requirements.txt` has updated versions (>=)
- Check Railway build logs for specific errors

**Stockfish not found:**
- Verify `STOCKFISH_PATH=/usr/games/stockfish` in Railway env vars
- Check Dockerfile installs stockfish via apt

### Vercel Issues

**API proxy returns 502:**
- Verify `SCOUT_API_URL` is set correctly
- Test Railway URL directly with curl
- Check Railway logs for errors

**Build fails:**
- Check Vercel build logs
- Verify all dependencies in package.json
- Ensure TypeScript compiles without errors

### Scout Dashboard Issues

**Brain icon doesn't fetch predictions:**
- Open browser console (F12)
- Check for network errors
- Verify `/api/scout/predict` returns 200
- Check Scout API is running

**Logic trace empty:**
- Verify prediction response includes `trace_log` array
- Check Scout API logs for errors
- Ensure opponent has style markers loaded

## 7. Python 3.13 Compatibility

Updated dependencies in `requirements.txt`:
```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-chess>=1.11.0
numpy>=1.26.0
pydantic>=2.9.0
httpx>=0.27.0
python-dotenv>=1.0.0
asyncpg>=0.30.0
```

These versions ensure compatibility with Python 3.13's updated C API and build system.

## 8. Monitoring & Logs

### Railway Logs
```bash
# View real-time logs
railway logs --follow

# Or in Railway dashboard:
# Project → Deployments → View Logs
```

### Vercel Logs
```bash
# View deployment logs
vercel logs

# Or in Vercel dashboard:
# Project → Deployments → View Function Logs
```

## 9. Future Enhancements

- [ ] Add database integration for persistent style markers
- [ ] Implement rate limiting on Scout API
- [ ] Add authentication for Scout API endpoints
- [ ] Cache engine evaluations for common positions
- [ ] Add metrics/analytics for Scout predictions
- [ ] Implement A/B testing for phase weight tuning
