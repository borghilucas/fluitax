#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/tmp/pids"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_PORT="${PORT:-4002}"
FRONTEND_PORT="${DEV_SERVER_PORT:-3000}"

stop_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name já está parado."
    return
  fi

  local pid
  pid="$(<"$pid_file")"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$name PID indefinido, removendo arquivo." 
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo "$name não está em execução (PID $pid). Limpando arquivo." 
    return
  fi

  echo "Encerrando $name (PID $pid)..."
  kill "$pid"

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "$name não respondeu a SIGTERM; enviando SIGKILL." >&2
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  echo "$name encerrado."
}

stop_process "Backend" "$BACKEND_PID_FILE"
stop_process "Frontend" "$FRONTEND_PID_FILE"

echo "Limpando portas $BACKEND_PORT e $FRONTEND_PORT..."
kill -9 $(lsof -ti tcp:"$BACKEND_PORT") 2>/dev/null || true
kill -9 $(lsof -ti tcp:"$FRONTEND_PORT") 2>/dev/null || true

echo "Serviços finalizados."
