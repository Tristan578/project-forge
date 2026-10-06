#!/usr/bin/env bash
# Refuse to run the engine-journeys job against any database but the one this
# run provisioned (#10161).
#
# WHAT IT CHECKS
#
#   DATABASE_URL            must be a postgres:// or postgresql:// URL whose
#                           host is EXACTLY the expected host.
#   E2E_NEON_HTTP_ENDPOINT  must be an http:// or https:// URL whose host is
#                           EXACTLY the expected host. Without it the neon HTTP
#                           driver posts every query to Neon cloud, whatever
#                           DATABASE_URL says, so its absence is a failure here
#                           rather than a mystery at migrate time.
#   E2E_DB_EXPECTED_HOST    the expected host; defaults to `localhost`, which is
#                           what the job's Postgres service container and its
#                           Neon-protocol proxy are published on. An operator
#                           override for running the journeys locally against a
#                           differently named proxy; the workflow never sets it
#                           (pinned by the suite).
#
# WHY STRICT EQUALITY, NOT "LOOPBACK"
#
# The proxy's HTTP path reads the endpoint id off the hostname's first label
# and rejects an IP literal, so `127.0.0.1` is not a working alternative to
# `localhost` — it is a URL the driver cannot use. And a host that merely
# contains the expected name (`localhost.evil.example`) is the oldest URL trick
# there is. The host is PARSED out of the URL and compared whole.
#
# NEVER PRINTS A CREDENTIAL. Only hostnames and variable names reach the log.
# No arguments: a connection string on argv is visible to every process on
# the runner, so one is refused outright.
#
# Exit 0 when both hosts are the expected one; 1 otherwise. Tested by
# scripts/__tests__/assert-e2e-db-host.test.sh, which also pins the wiring in
# ci.yml (the guard runs in the journeys job, before migrate).
set -uo pipefail

if [ "$#" -ne 0 ]; then
  echo "::error::assert-e2e-db-host: takes no arguments — pass DATABASE_URL and E2E_NEON_HTTP_ENDPOINT through the environment, never argv" >&2
  exit 1
fi

EXPECTED_HOST="${E2E_DB_EXPECTED_HOST:-localhost}"

# url_host <url>
# Prints the hostname of <url>: scheme and userinfo stripped (the LAST `@`
# before the path ends the userinfo, so an `@` inside a password is kept on the
# password side), port and path dropped, IPv6 brackets removed.
url_host() {
  local rest authority hostport host
  rest="${1#*://}"
  authority="${rest%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%\#*}"
  hostport="${authority##*@}"
  if [ "${hostport#\[}" != "$hostport" ]; then
    host="${hostport%%]*}"
    host="${host#\[}"
  else
    host="${hostport%%:*}"
  fi
  printf '%s' "$host"
}

# url_scheme <url>
url_scheme() {
  case "$1" in
    *://*) printf '%s' "${1%%://*}" ;;
    *) printf '' ;;
  esac
}

problems=0
problem() {
  echo "::error::assert-e2e-db-host: $1" >&2
  problems=$((problems + 1))
}

if [ -z "${DATABASE_URL:-}" ]; then
  problem "DATABASE_URL is not set — the job has no database to guard"
else
  scheme="$(url_scheme "$DATABASE_URL")"
  case "$scheme" in
    postgres|postgresql) ;;
    *) problem "DATABASE_URL must be a postgres:// or postgresql:// URL; got scheme '${scheme:-none}'" ;;
  esac
  db_host="$(url_host "$DATABASE_URL")"
  if [ "$db_host" != "$EXPECTED_HOST" ]; then
    problem "DATABASE_URL host is '${db_host:-empty}', expected '${EXPECTED_HOST}' (the host this run provisioned) — refusing to migrate, drift-check or serve against it"
  fi
fi

if [ -z "${E2E_NEON_HTTP_ENDPOINT:-}" ]; then
  problem "E2E_NEON_HTTP_ENDPOINT is not set — without it the neon HTTP driver posts queries to Neon cloud regardless of DATABASE_URL"
else
  ep_scheme="$(url_scheme "$E2E_NEON_HTTP_ENDPOINT")"
  case "$ep_scheme" in
    http|https) ;;
    *) problem "E2E_NEON_HTTP_ENDPOINT must be an http:// or https:// URL; got scheme '${ep_scheme:-none}'" ;;
  esac
  ep_host="$(url_host "$E2E_NEON_HTTP_ENDPOINT")"
  if [ "$ep_host" != "$EXPECTED_HOST" ]; then
    problem "E2E_NEON_HTTP_ENDPOINT host is '${ep_host:-empty}', expected '${EXPECTED_HOST}' (the proxy this run started)"
  fi
fi

if [ "$problems" -ne 0 ]; then
  exit 1
fi

echo "assert-e2e-db-host: DATABASE_URL host '${EXPECTED_HOST}' and E2E_NEON_HTTP_ENDPOINT host '${EXPECTED_HOST}' are the ones this run provisioned"
