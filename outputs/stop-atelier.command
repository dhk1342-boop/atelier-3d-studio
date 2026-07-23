#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/kimdohyeon/Documents/Codex/2026-07-22/shapr3d-3d"
PID_FILE="$PROJECT_DIR/work/vite.pid"
PORT_FILE="$PROJECT_DIR/work/vite.port"
PORT="4174"

STOPPED="0"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill "$PID" >/dev/null 2>&1; then
    STOPPED="1"
  fi
  rm -f "$PID_FILE"
fi

PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "$PIDS" | xargs kill >/dev/null 2>&1 || true
  STOPPED="1"
fi

for LEGACY_PORT in 5173 5174 5175 5176 5177 5178 5179; do
  LEGACY_PIDS="$(lsof -tiTCP:"$LEGACY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$LEGACY_PIDS" ]]; then
    echo "$LEGACY_PIDS" | xargs kill >/dev/null 2>&1 || true
    STOPPED="1"
  fi
done

rm -f "$PORT_FILE"

if [[ "$STOPPED" == "1" ]]; then
  echo "아틀리에 3D 서버를 종료했습니다."
else
  echo "실행 중인 아틀리에 3D 서버를 찾지 못했습니다."
fi

echo
read '?이 창을 닫으려면 Enter를 누르세요. '
