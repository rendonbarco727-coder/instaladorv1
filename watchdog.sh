#!/bin/bash
while true; do
  if ! pgrep -f "node index.js" > /dev/null; then
    echo "$(date) - Reiniciando servidor BMO..." >> ~/wa-ollama/logs/watchdog.log
    cd ~/wa-ollama && nohup node index.js >> ~/wa-ollama/logs/bmo.log 2>&1 &
  fi
  sleep 30
done
