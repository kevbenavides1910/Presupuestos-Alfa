#!/usr/bin/env bash

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
MAX_TIME="${MAX_TIME:-8}"
LOG_DIR="${LOG_DIR:-/var/log/presupuestos-alfa}"
APP_CONTAINER="${APP_CONTAINER:-security_contracts_app}"
DB_CONTAINER="${DB_CONTAINER:-security_contracts_db}"

mkdir -p "$LOG_DIR"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
day_stamp="$(date -u +"%Y-%m-%d")"
summary_file="$LOG_DIR/health-$day_stamp.log"

check_endpoint() {
  local endpoint="$1"
  local output
  output="$(curl -sS -o /dev/null -w "%{http_code} %{time_total}" --max-time "$MAX_TIME" "$BASE_URL$endpoint" 2>&1)"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    local http_code
    local total_time
    http_code="$(echo "$output" | awk '{print $1}')"
    total_time="$(echo "$output" | awk '{print $2}')"
    echo "$timestamp OK $endpoint code=$http_code time=${total_time}s" >> "$summary_file"
    if [ "$http_code" -ge 500 ]; then
      return 2
    fi
    return 0
  fi

  echo "$timestamp FAIL $endpoint curl_exit=$exit_code details=$output" >> "$summary_file"
  return 1
}

capture_snapshot() {
  local reason="$1"
  local snapshot_file="$LOG_DIR/snapshot-$(date -u +"%Y%m%dT%H%M%SZ").log"

  {
    echo "=== Snapshot UTC $timestamp ==="
    echo "reason: $reason"
    echo "base_url: $BASE_URL"
    echo

    echo "## docker compose ps"
    docker compose -f docker-compose.prod.yml ps 2>&1 || true
    echo

    echo "## docker stats --no-stream"
    docker stats --no-stream 2>&1 || true
    echo

    echo "## free -h"
    free -h 2>&1 || true
    echo

    echo "## df -h"
    df -h 2>&1 || true
    echo

    echo "## dmesg OOM scan"
    dmesg -T 2>/dev/null | grep -Ei "killed process|out of memory|oom" | tail -n 80 || true
    echo

    echo "## app logs tail"
    docker logs --tail 200 "$APP_CONTAINER" 2>&1 || true
    echo

    echo "## db logs tail"
    docker logs --tail 200 "$DB_CONTAINER" 2>&1 || true
    echo
  } > "$snapshot_file"

  echo "$timestamp SNAPSHOT reason=$reason file=$snapshot_file" >> "$summary_file"
}

failure_reason=""

check_endpoint "/login" || failure_reason="login_unhealthy"
check_endpoint "/api/auth/session" || failure_reason="${failure_reason:-session_unhealthy}"

if [ -n "$failure_reason" ]; then
  capture_snapshot "$failure_reason"
fi
