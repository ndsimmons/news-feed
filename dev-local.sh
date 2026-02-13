#!/bin/bash

# Development script to run both Astro and Wrangler dev servers
# Usage: ./dev-local.sh

echo "🚀 Starting News Feed Development Servers..."
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $WORKER_PID $ASTRO_PID 2>/dev/null
    exit
}

# Set up cleanup trap
trap cleanup INT TERM

# Start the worker in background
echo "📦 Starting Cloudflare Worker (http://localhost:8787)..."
wrangler dev workers/api.ts --local --port 8787 &
WORKER_PID=$!

# Wait a moment for worker to start
sleep 3

# Start Astro dev server in background
echo "🌐 Starting Astro Dev Server (http://localhost:4323)..."
npm run dev &
ASTRO_PID=$!

# Wait a moment for Astro to start
sleep 3

echo ""
echo "✅ Both servers are running!"
echo ""
echo "   Frontend: http://localhost:4323/"
echo "   Worker:   http://localhost:8787/"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for both processes
wait $WORKER_PID $ASTRO_PID
