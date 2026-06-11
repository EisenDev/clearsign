#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_VENV_DIR="${BACKEND_VENV_DIR:-${BACKEND_DIR}/venv}"
BACKEND_REQUIREMENTS_FILE="${BACKEND_DIR}/requirements.txt"
FRONTEND_PACKAGE_FILE="${FRONTEND_DIR}/package.json"

FASTAPI_HOST="${FASTAPI_HOST:-127.0.0.1}"
FASTAPI_PORT="${FASTAPI_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
UVICORN_APP="${UVICORN_APP:-app.main:app}"
CELERY_APP="${CELERY_APP:-app.workers.bg_removal:celery_app}"
CELERY_LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://${FASTAPI_HOST}:${FASTAPI_PORT}}"

export BACKEND_HOST="${FASTAPI_HOST}"
export BACKEND_PORT="${FASTAPI_PORT}"
export NEXT_PUBLIC_API_URL
export PYTHONUNBUFFERED=1

log() {
  printf '[start_dev] %s\n' "$*"
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  fi
}

get_port_pids() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
}

clear_port() {
  local port="$1"
  local pids
  pids="$(get_port_pids "${port}")"

  if [[ -z "${pids}" ]]; then
    return
  fi

  log "Clearing processes on port ${port}: ${pids//$'\n'/ }"
  kill ${pids} 2>/dev/null || true
  sleep 1

  local remaining_pids
  remaining_pids="$(get_port_pids "${port}")"
  if [[ -n "${remaining_pids}" ]]; then
    log "Force killing remaining processes on port ${port}: ${remaining_pids//$'\n'/ }"
    kill -9 ${remaining_pids} 2>/dev/null || true
    sleep 1
  fi
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM
  log "Stopping development services..."

  local job_pids
  job_pids="$(jobs -pr || true)"
  if [[ -n "${job_pids}" ]]; then
    kill ${job_pids} 2>/dev/null || true
    wait ${job_pids} 2>/dev/null || true
  fi

  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

require_command npm
require_command python3
require_command lsof

if [[ ! -d "${BACKEND_DIR}" ]]; then
  printf 'Backend directory not found: %s\n' "${BACKEND_DIR}" >&2
  exit 1
fi

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  printf 'Frontend directory not found: %s\n' "${FRONTEND_DIR}" >&2
  exit 1
fi

if [[ ! -f "${BACKEND_REQUIREMENTS_FILE}" ]]; then
  printf 'Backend requirements file not found: %s\n' "${BACKEND_REQUIREMENTS_FILE}" >&2
  exit 1
fi

if [[ ! -f "${FRONTEND_PACKAGE_FILE}" ]]; then
  printf 'Frontend package file not found: %s\n' "${FRONTEND_PACKAGE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${BACKEND_VENV_DIR}/bin/activate" ]]; then
  log "Creating Python virtual environment at ${BACKEND_VENV_DIR}"
  python3 -m venv "${BACKEND_VENV_DIR}"
fi

clear_port "${FRONTEND_PORT}"
clear_port "${FASTAPI_PORT}"

log "Installing backend dependencies"
(
  cd "${BACKEND_DIR}"
  source "${BACKEND_VENV_DIR}/bin/activate"
  python -m pip install --upgrade pip
  python -m pip install -r "${BACKEND_REQUIREMENTS_FILE}"
)

log "Installing frontend dependencies"
(
  cd "${FRONTEND_DIR}"
  npm install
)

log "Starting FastAPI on http://${FASTAPI_HOST}:${FASTAPI_PORT}"
(
  cd "${BACKEND_DIR}"
  source "${BACKEND_VENV_DIR}/bin/activate"
  exec python -m uvicorn "${UVICORN_APP}" --host "${FASTAPI_HOST}" --port "${FASTAPI_PORT}" --reload
) &

log "Starting Celery worker (${CELERY_APP})"
(
  cd "${BACKEND_DIR}"
  source "${BACKEND_VENV_DIR}/bin/activate"
  export OMP_NUM_THREADS=1
  export MKL_NUM_THREADS=1
  export OPENBLAS_NUM_THREADS=1
  export VECLIB_MAXIMUM_THREADS=1
  export NUMEXPR_NUM_THREADS=1
  export NUMBA_THREADING_LAYER=workqueue
  exec python -m celery -A "${CELERY_APP}" worker --loglevel="${CELERY_LOG_LEVEL}" --concurrency="${CELERY_CONCURRENCY}"
) &

log "Starting Next.js on http://127.0.0.1:${FRONTEND_PORT}"
(
  cd "${FRONTEND_DIR}"
  exec npm run dev -- --hostname 127.0.0.1 --port "${FRONTEND_PORT}"
) &

log "Services are running. Press Ctrl+C once to stop everything."
wait
