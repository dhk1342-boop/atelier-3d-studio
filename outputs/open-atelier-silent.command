#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/kimdohyeon/Documents/Codex/2026-07-22/shapr3d-3d"
NODE_DIR="/Users/kimdohyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
PID_FILE="$PROJECT_DIR/work/vite.pid"
PORT_FILE="$PROJECT_DIR/work/vite.port"
LOG_FILE="$PROJECT_DIR/work/atelier-server.log"
BUILD_LOG_FILE="$PROJECT_DIR/work/atelier-build.log"
PORT="4174"

export PATH="$NODE_DIR:$PATH"

mkdir -p "$PROJECT_DIR/work"
cd "$PROJECT_DIR"

open_atelier_web() {
  local target_url="$1"
  open "$target_url"
}

PYTHON_BIN="$(command -v python3 || true)"
if [[ -z "$PYTHON_BIN" && -x /usr/bin/python3 ]]; then
  PYTHON_BIN="/usr/bin/python3"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  osascript -e 'display alert "아틀리에 3D" message "python3 를 찾지 못했습니다." as warning'
  exit 1
fi

if [[ -f "$PID_FILE" && -f "$PORT_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  EXISTING_PORT="$(cat "$PORT_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:$EXISTING_PORT/" >/dev/null 2>&1; then
      open_atelier_web "http://localhost:$EXISTING_PORT/"
      exit 0
    fi
  fi
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:$PORT/" | rg -q "아틀리에 3D 스튜디오"; then
    echo "$PORT" > "$PORT_FILE"
    open_atelier_web "http://localhost:$PORT/"
    exit 0
  fi

  osascript -e 'display alert "아틀리에 3D" message "포트 4174가 이미 사용 중입니다. 다른 로컬 서버를 닫고 다시 시도해 주세요." as warning'
  exit 1
fi

NEEDS_BUILD="0"
if [[ ! -f "$PROJECT_DIR/dist/index.html" ]]; then
  NEEDS_BUILD="1"
elif [[ -n "$(find "$PROJECT_DIR/src" "$PROJECT_DIR/index.html" "$PROJECT_DIR/package.json" "$PROJECT_DIR/tsconfig.json" -type f -newer "$PROJECT_DIR/dist/index.html" -print -quit 2>/dev/null)" ]]; then
  NEEDS_BUILD="1"
fi

if [[ "$NEEDS_BUILD" == "1" ]]; then
  "$NODE_DIR/node" "$PROJECT_DIR/node_modules/vite/bin/vite.js" build >"$BUILD_LOG_FILE" 2>&1 || {
    osascript -e 'display alert "아틀리에 3D" message "빌드 중 문제가 생겼습니다. work/atelier-build.log 를 확인해 주세요." as warning'
    exit 1
  }
fi

nohup "$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1 --directory "$PROJECT_DIR/dist" >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "$PORT" > "$PORT_FILE"

READY="0"
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    READY="1"
    break
  fi
  sleep 1
done

if [[ "$READY" != "1" ]]; then
  rm -f "$PID_FILE" "$PORT_FILE"
  osascript -e 'display alert "아틀리에 3D" message "서버가 시간 안에 응답하지 않았습니다. work/atelier-server.log 를 확인해 주세요." as warning'
  exit 1
fi

open_atelier_web "http://localhost:$PORT/"
