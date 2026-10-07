#!/usr/bin/env bash
# Start the Kanakku Pusthakam and open it in the browser.
# Usage: ./start.sh            (port 5000)
#        ./start.sh --port 5050
cd "$(dirname "$0")" || exit 1
exec python3 run.py --open "$@"
