# Use Python 3.13 slim image
FROM python:3.13-slim

# Install system dependencies including Stockfish
RUN apt-get update && apt-get install -y \
    stockfish \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variable for Stockfish path (Railway default location)
ENV STOCKFISH_PATH=/usr/games/stockfish

# Expose port (Railway will set PORT env var)
EXPOSE 8001

# Run the application (use PORT env var if set, otherwise 8001)
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}
