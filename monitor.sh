#!/bin/bash
# BreadCall Docker Resource Monitor
# Usage: ./monitor.sh [interval_seconds]

INTERVAL=${1:-5}

echo "=========================================="
echo "  BreadCall Resource Monitor"
echo "  Press Ctrl+C to exit"
echo "=========================================="
echo ""

while true; do
    clear
    echo "=========================================="
    echo "  BreadCall Resource Monitor"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=========================================="
    echo ""

    # Container stats
    echo "--- Container Resource Usage ---"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}" 2>/dev/null || echo "No containers running"

    echo ""
    echo "--- Service Health Checks ---"

    # Test signaling
    if curl -s http://localhost:3000/health >/dev/null 2>&1; then
        echo "✓ Signaling (port 3000): HEALTHY"
    else
        echo "✗ Signaling (port 3000): DOWN"
    fi

    # Test nginx
    if curl -s http://localhost/health >/dev/null 2>&1; then
        echo "✓ Web/Nginx (port 80): HEALTHY"
    else
        echo "✗ Web/Nginx (port 80): DOWN"
    fi

    # Test coturn - check if port is listening
    if ss -tuln | grep -q ':3478'; then
        echo "✓ Coturn (port 3478): LISTENING"
    else
        echo "✗ Coturn (port 3478): DOWN"
    fi

    echo ""
    echo "--- Network Connections ---"
    echo "Active connections: $(ss -tun | wc -l)"

    echo ""
    echo "--- Recent Container Events ---"
    docker events --since="${INTERVAL}s" --filter "event=oom" --filter "event=die" 2>/dev/null | tail -5 || echo "No events"

    sleep $INTERVAL
done
