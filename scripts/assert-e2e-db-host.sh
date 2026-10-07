#!/usr/bin/env bash
# Refuse to run the engine-journeys job against any database but the one this
# run provisioned (#10161).
#
# WHAT IT CHECKS
#
#   DATABASE_URL            must be a postgres:// or postgresql:// URL whose
#                           host is EXACTLY the expected host, with NO query
#                           string and no backslash (see below).
#   E2E_NEON_HTTP_ENDPOINT  must be an http:// or https:// URL whose host is
#                           EXACTLY the expected host, with no backslash.
#                           Without it the neon HTTP driver posts every query to
#                           Neon cloud, whatever DATABASE_URL says, so its
#                           absence is a failure here rather than a mystery at
#                           migrate time.
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
# WHY NO QUERY STRING, AND NO BACKSLASH
#
# The authority is not the only place a URL can name a host. libpq, psql (which
# the proxy's start.sh runs against its own connection string) and the Rust
# postgres config all honour `host=`, `hostaddr=` and `service=` in the query
# string OVER the authority, so
#   postgres://u:p@localhost:5432/db?host=evil.example
# reads as `localhost` to a parser of the authority and connects to
# evil.example. The job's DATABASE_URL carries no query at all, so ANY `?` on it
# is refused rather than enumerating the parameters that redirect a connection.
#
# A backslash is the other way one URL reads as two hosts: the WHATWG parser
# behind fetch() treats `\` as `/` in an http URL, so
#   http://evil.example\@localhost/sql
# is evil.example to the driver and `localhost` to a last-`@` split. Neither URL
# in the job contains one, so a backslash in either is refused outright.
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

# has_backslash <value> — true when the value contains a `\`.
has_backslash() {
  case "$1" in
    *\\*) return 0 ;;
    *) return 1 ;;
  esac
}

# has_query <value> — true when the value contains a `?`.
has_query() {
  case "$1" in
    *\?*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -z "${DATABASE_URL:-}" ]; then
  problem "DATABASE_URL is not set — the job has no database to guard"
else
  scheme="$(url_scheme "$DATABASE_URL")"
  case "$scheme" in
    postgres|postgresql) ;;
    *) problem "DATABASE_URL must be a postgres:// or postgresql:// URL; got scheme '${scheme:-none}'" ;;
  esac
  # The query string and the backslash are named, never echoed: a query can
  # carry `password=` or a token, and this log is public.
  if has_query "$DATABASE_URL"; then
    problem "DATABASE_URL must not carry a query string — libpq honours host=, hostaddr= and service= there over the URL's own host, so the host check below would be reading the wrong one"
  fi
  if has_backslash "$DATABASE_URL"; then
    problem "DATABASE_URL must not contain a backslash — parsers disagree on where the host ends, so the host check below would be reading the wrong one"
  fi
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
  # fetch() reads `\` as `/` in an http URL, so `http://evil.example\@localhost/`
  # is evil.example to the driver and `localhost` to the parse below.
  if has_backslash "$E2E_NEON_HTTP_ENDPOINT"; then
    problem "E2E_NEON_HTTP_ENDPOINT must not contain a backslash — fetch() reads it as a slash, so the host check below would be reading the wrong host"
  fi
  ep_host="$(url_host "$E2E_NEON_HTTP_ENDPOINT")"
  if [ "$ep_host" != "$EXPECTED_HOST" ]; then
    problem "E2E_NEON_HTTP_ENDPOINT host is '${ep_host:-empty}', expected '${EXPECTED_HOST}' (the proxy this run started)"
  fi
fi

if [ "$problems" -ne 0 ]; then
  exit 1
fi

echo "assert-e2e-db-host: DATABASE_URL host '${EXPECTED_HOST}' and E2E_NEON_HTTP_ENDPOINT host '${EXPECTED_HOST}' are the ones this run provisioned"
