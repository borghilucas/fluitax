#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/tmp/pids"
LOG_DIR="$ROOT_DIR/tmp/logs"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PORT="${PORT:-4002}"
FRONTEND_PORT="${DEV_SERVER_PORT:-3000}"
ENV_FILE="$ROOT_DIR/.env"

mkdir -p "$PID_DIR" "$LOG_DIR"

clean_stale_pid() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(<"$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Process already running with PID $pid (from $pid_file). Use scripts/stop.sh first." >&2
      exit 1
    fi
    rm -f "$pid_file"
  fi
}

require_file() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    echo "Required file not found: $file_path" >&2
    exit 1
  fi
}

ensure_db() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql não encontrado. Instale o cliente do PostgreSQL para continuar." >&2
    exit 1
  fi

  # Carrega DATABASE_URL do .env se ainda não estiver no ambiente
  if [[ -z "${DATABASE_URL:-}" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL não definido. Ajuste no .env." >&2
    exit 1
  fi

  local parsed
  parsed=$(DATABASE_URL="$DATABASE_URL" node -e "
    const url = new URL(process.env.DATABASE_URL);
    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    const user = url.username || 'postgres';
    const pass = url.password || '';
    const db = (url.pathname || '').replace(/^\//, '') || 'postgres';
    console.log([host, port, user, pass, db].join(' '));
  ")

  read -r DB_HOST DB_PORT DB_USER DB_PASS DB_NAME <<<"$parsed"

  export PGPASSWORD="$DB_PASS"
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "select 1" >/dev/null 2>&1; then
    echo "Banco $DB_NAME em $DB_HOST:$DB_PORT acessível."
    return
  fi

  echo "Banco $DB_NAME não encontrado ou inacessível. Tentando criar..."
  if ! PGPASSWORD="$DB_PASS" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"; then
    echo "Falha ao criar o banco $DB_NAME. Verifique se o Postgres está rodando e credenciais estão corretas." >&2
    exit 1
  fi
  echo "Banco $DB_NAME criado com sucesso."
}

start_backend() {
  pushd "$ROOT_DIR" >/dev/null

  echo "Installing backend dependencies..."
  npm install --silent

  echo "Applying database migrations..."
  npx prisma migrate deploy

  echo "Generating Prisma client..."
  npx prisma generate --schema prisma/schema.prisma >/dev/null

  echo "Starting backend on port $BACKEND_PORT..."
  PORT="$BACKEND_PORT" npm start >"$BACKEND_LOG" 2>&1 &
  local pid=$!
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Backend failed to start. Check log at $BACKEND_LOG" >&2
    exit 1
  fi
  echo "$pid" >"$BACKEND_PID_FILE"
  echo "Backend running with PID $pid (log: $BACKEND_LOG)"

  popd >/dev/null
}

start_frontend() {
  pushd "$ROOT_DIR/web" >/dev/null

  echo "Installing frontend dependencies..."
  npm install --silent

  echo "Starting frontend on port $FRONTEND_PORT..."
  npm run dev -- --port "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
  local pid=$!
  sleep 3
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Frontend failed to start. Check log at $FRONTEND_LOG" >&2
    exit 1
  fi
  echo "$pid" >"$FRONTEND_PID_FILE"
  echo "Frontend running with PID $pid (log: $FRONTEND_LOG)"

  popd >/dev/null
}

clean_stale_pid "$BACKEND_PID_FILE"
clean_stale_pid "$FRONTEND_PID_FILE"

require_file "$ROOT_DIR/.env"
require_file "$ROOT_DIR/web/.env.local"

echo "Verificando disponibilidade do banco..."
ensure_db

start_backend
start_frontend

echo "All services are up."
