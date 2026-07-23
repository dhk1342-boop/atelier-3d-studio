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
  echo "python3 를 찾지 못했습니다."
  exit 1
fi

if [[ -f "$PID_FILE" && -f "$PORT_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  EXISTING_PORT="$(cat "$PORT_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:$EXISTING_PORT/" >/dev/null 2>&1; then
      open_atelier_web "http://localhost:$EXISTING_PORT/"
      echo "아틀리에 3D가 이미 실행 중입니다: http://localhost:$EXISTING_PORT/"
      echo
      echo "웹 브라우저를 열었습니다."
      echo "나중에 로컬 사이트를 끄려면 outputs/stop-atelier.command 를 실행하세요."
      echo
      read '?이 창을 닫으려면 Enter를 누르세요. '
      exit 0
    fi
  fi
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:$PORT/" | rg -q "아틀리에 3D 스튜디오"; then
    echo "$PORT" > "$PORT_FILE"
    open_atelier_web "http://localhost:$PORT/"
    echo "아틀리에 3D가 이미 실행 중입니다: http://localhost:$PORT/"
    echo
    echo "웹 브라우저를 열었습니다."
    echo "나중에 로컬 사이트를 끄려면 outputs/stop-atelier.command 를 실행하세요."
    echo
    read '?이 창을 닫으려면 Enter를 누르세요. '
    exit 0
  fi

  echo "포트 $PORT 가 이미 사용 중입니다."
  echo "다른 로컬 서버를 닫은 뒤 다시 실행해 주세요."
  exit 1
fi

NEEDS_BUILD="0"
if [[ ! -f "$PROJECT_DIR/dist/index.html" ]]; then
  NEEDS_BUILD="1"
elif [[ -n "$(find "$PROJECT_DIR/src" "$PROJECT_DIR/index.html" "$PROJECT_DIR/package.json" "$PROJECT_DIR/tsconfig.json" -type f -newer "$PROJECT_DIR/dist/index.html" -print -quit 2>/dev/null)" ]]; then
  NEEDS_BUILD="1"
fi

if [[ "$NEEDS_BUILD" == "1" ]]; then
  echo "웹 버전을 준비하는 중입니다..."
  "$NODE_DIR/node" "$PROJECT_DIR/node_modules/vite/bin/vite.js" build >"$BUILD_LOG_FILE" 2>&1
fi

echo "아틀리에 3D를 시작합니다: http://localhost:$PORT/"
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
  echo "서버가 시간 안에 응답하지 않았습니다."
  echo "로그를 확인하세요: $LOG_FILE"
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 1
fi

open_atelier_web "http://localhost:$PORT/"
echo
echo "웹 브라우저를 열었습니다."
echo "나중에 로컬 사이트를 끄려면 outputs/stop-atelier.command 를 실행하세요."
echo
read '?이 창을 닫으려면 Enter를 누르세요. '
