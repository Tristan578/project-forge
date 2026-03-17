#!/usr/bin/env bash
# verify-ssl-certs.sh — SpawnForge SSL/TLS Certificate Verification
#
# Checks SSL certificate expiry for all SpawnForge domains.
# Exits non-zero if any certificate is within the alert threshold.
#
# Usage:
#   bash scripts/verify-ssl-certs.sh [--warn-days N] [--alert-days N]
#
# Options:
#   --warn-days N    Warn if certificate expires within N days (default: 30)
#   --alert-days N   Alert (exit 2) if certificate expires within N days (default: 7)
#   --quiet          Suppress informational output; only print warnings/alerts
#   --json           Output structured JSON report

set -euo pipefail

# ---------------------------------------------------------------------------
# Domains to check
# ---------------------------------------------------------------------------
DOMAINS=(
  "spawnforge.ai"
  "engine.spawnforge.ai"
)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
WARN_DAYS=30
ALERT_DAYS=7
QUIET=false
JSON_OUTPUT=false

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --warn-days)
      WARN_DAYS="$2"
      shift 2
      ;;
    --alert-days)
      ALERT_DAYS="$2"
      shift 2
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl is required but not installed." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  if [[ "$QUIET" == false ]]; then
    echo "$@"
  fi
}

# Returns the certificate expiry date as seconds since epoch.
# Prints an error message and returns 1 on failure.
get_cert_expiry_epoch() {
  local domain="$1"
  local port="${2:-443}"

  local cert_info
  cert_info=$(echo "" | timeout 10 openssl s_client \
    -connect "${domain}:${port}" \
    -servername "${domain}" \
    -verify_return_error \
    2>/dev/null) || return 1

  local expiry_str
  expiry_str=$(echo "$cert_info" | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//') || return 1

  if [[ -z "$expiry_str" ]]; then
    return 1
  fi

  # Convert to epoch. macOS uses BSD date, Linux uses GNU date.
  if date --version &>/dev/null 2>&1; then
    # GNU date
    date -d "$expiry_str" +%s
  else
    # BSD date (macOS)
    date -j -f "%b %d %T %Y %Z" "$expiry_str" +%s 2>/dev/null \
      || date -j -f "%b  %d %T %Y %Z" "$expiry_str" +%s
  fi
}

# Returns the certificate subject CN and SANs as a single string.
get_cert_subject() {
  local domain="$1"
  local port="${2:-443}"

  echo "" | timeout 10 openssl s_client \
    -connect "${domain}:${port}" \
    -servername "${domain}" \
    2>/dev/null \
    | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null \
    | tr '\n' ' '
}

# Returns the certificate issuer.
get_cert_issuer() {
  local domain="$1"
  local port="${2:-443}"

  echo "" | timeout 10 openssl s_client \
    -connect "${domain}:${port}" \
    -servername "${domain}" \
    2>/dev/null \
    | openssl x509 -noout -issuer 2>/dev/null \
    | sed 's/issuer=//'
}

# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------
NOW_EPOCH=$(date +%s)

overall_status=0   # 0=ok, 1=warn, 2=alert, 3=error
declare -a json_entries=()

log ""
log "SpawnForge SSL/TLS Certificate Verification"
log "============================================"
log "Checked at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
log "Warn threshold : ${WARN_DAYS} days"
log "Alert threshold: ${ALERT_DAYS} days"
log ""

for domain in "${DOMAINS[@]}"; do
  log "Checking: ${domain}"
  log "-------------------------------------------"

  expiry_epoch=$(get_cert_expiry_epoch "$domain") || {
    log "  STATUS : ERROR — could not retrieve certificate"
    log ""
    if [[ $overall_status -lt 3 ]]; then overall_status=3; fi
    if [[ "$JSON_OUTPUT" == true ]]; then
      json_entries+=("{\"domain\":\"${domain}\",\"status\":\"error\",\"error\":\"could not retrieve certificate\"}")
    fi
    continue
  }

  days_remaining=$(( (expiry_epoch - NOW_EPOCH) / 86400 ))
  expiry_date=$(date -r "$expiry_epoch" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null \
    || date -d "@$expiry_epoch" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null \
    || echo "unknown")
  issuer=$(get_cert_issuer "$domain")
  subject=$(get_cert_subject "$domain")

  log "  Expires       : ${expiry_date}"
  log "  Days remaining: ${days_remaining}"
  log "  Issuer        : ${issuer}"
  log "  Subject       : ${subject}"

  local_status="ok"

  if [[ $days_remaining -le $ALERT_DAYS ]]; then
    local_status="alert"
    echo "  ALERT: Certificate for ${domain} expires in ${days_remaining} days (threshold: ${ALERT_DAYS})" >&2
    if [[ $overall_status -lt 2 ]]; then overall_status=2; fi
  elif [[ $days_remaining -le $WARN_DAYS ]]; then
    local_status="warn"
    echo "  WARN:  Certificate for ${domain} expires in ${days_remaining} days (threshold: ${WARN_DAYS})" >&2
    if [[ $overall_status -lt 1 ]]; then overall_status=1; fi
  else
    log "  STATUS : OK"
  fi

  log ""

  if [[ "$JSON_OUTPUT" == true ]]; then
    json_entries+=("{\"domain\":\"${domain}\",\"status\":\"${local_status}\",\"days_remaining\":${days_remaining},\"expiry_date\":\"${expiry_date}\",\"issuer\":\"${issuer}\"}")
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log "============================================"
case $overall_status in
  0) log "Overall result: OK — all certificates are healthy" ;;
  1) log "Overall result: WARN — one or more certificates expire soon" ;;
  2) log "Overall result: ALERT — one or more certificates expire very soon" ;;
  3) log "Overall result: ERROR — one or more certificates could not be retrieved" ;;
esac
log ""

# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------
if [[ "$JSON_OUTPUT" == true ]]; then
  overall_label="ok"
  case $overall_status in
    1) overall_label="warn" ;;
    2) overall_label="alert" ;;
    3) overall_label="error" ;;
  esac

  echo "{"
  echo "  \"checked_at\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\","
  echo "  \"overall_status\": \"${overall_label}\","
  echo "  \"warn_threshold_days\": ${WARN_DAYS},"
  echo "  \"alert_threshold_days\": ${ALERT_DAYS},"
  echo "  \"results\": ["
  for i in "${!json_entries[@]}"; do
    if [[ $i -lt $(( ${#json_entries[@]} - 1 )) ]]; then
      echo "    ${json_entries[$i]},"
    else
      echo "    ${json_entries[$i]}"
    fi
  done
  echo "  ]"
  echo "}"
fi

# ---------------------------------------------------------------------------
# Exit code
# ---------------------------------------------------------------------------
# 0 = all ok
# 1 = one or more warnings (expiry within WARN_DAYS)
# 2 = one or more alerts (expiry within ALERT_DAYS) — treat as failure
# 3 = could not retrieve one or more certificates
exit $overall_status
