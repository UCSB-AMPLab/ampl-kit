#!/usr/bin/env bash
# Deployment smoke probe
#
# This script is a quick post-deploy sanity check for the ampl-auth service.
# Given a base URL, it confirms the service is actually up and serving: it
# fetches the landing page, loads the lightweight `/ping` health route, posts a
# unique token to `/ping`, then re-reads it to prove the request round-trips all
# the way through the D1 database. It exits non-zero on the first failed step,
# so it can gate a deploy or be run by hand against any deployed URL.
#
# Usage: scripts/smoke.sh <BASE_URL>
#
# Version: v0.1.0

set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "usage: $0 <BASE_URL>" >&2
  exit 2
fi

# Strip trailing slash for clean concatenation.
BASE_URL="${BASE_URL%/}"

TOKEN="smoke-$$-$(date +%s)"
echo "[smoke] base: $BASE_URL"
echo "[smoke] token: $TOKEN"

# 1. GET / — expect an HTML document (the signed-out landing page).
echo "[smoke] 1/4 GET $BASE_URL/"
body=$(curl -sfL --max-time 15 "$BASE_URL/")
echo "$body" | grep -q '<html' || { echo "[smoke] FAIL: / did not return <html>"; exit 1; }

# 2. GET /ping — expect <form> (the insert form is present)
echo "[smoke] 2/4 GET $BASE_URL/ping"
body=$(curl -sfL --max-time 15 "$BASE_URL/ping")
echo "$body" | grep -q '<form' || { echo "[smoke] FAIL: /ping did not return <form>"; exit 1; }

# 3. POST /ping with a unique token — expect 2xx or 3xx (redirect follow via -L).
# NOTE: no explicit `-X POST`; `--data-urlencode` already implies POST, and the explicit flag
# would force curl to keep POSTing after the 302, which breaks the action's post-redirect-get pattern.
echo "[smoke] 3/4 POST $BASE_URL/ping note=$TOKEN"
curl -sfL --max-time 15 --data-urlencode "note=$TOKEN" "$BASE_URL/ping" >/dev/null \
  || { echo "[smoke] FAIL: POST /ping rejected"; exit 1; }

# 4. GET /ping — expect the unique token to appear in the rendered list (round-trip proof)
echo "[smoke] 4/4 GET $BASE_URL/ping (verify round-trip)"
body=$(curl -sfL --max-time 15 "$BASE_URL/ping")
echo "$body" | grep -q "$TOKEN" || { echo "[smoke] FAIL: token '$TOKEN' not visible after POST+GET"; exit 1; }

echo "[smoke] PASS: / + /ping round-trip green at $BASE_URL"
