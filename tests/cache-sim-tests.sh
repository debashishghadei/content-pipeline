#!/bin/bash
# Live-check blind-spot test (ChatGPT review of 0.1.1).
# A simulated cache serves a cached private page to ordinary visitors but obeys
# "Cache-Control: no-cache". The Live check must still notice the cached answer.
#
# DISPOSABLE TEST SITES ONLY: temporarily changes the site address.
# Usage: CP_TEST_DISPOSABLE=1 tests/cache-sim-tests.sh
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
DIR=$(cd "$(dirname "$0")" && pwd)
SITE_PORT="${SITE_PORT:-8080}"
PROXY_PORT="${PROXY_PORT:-8090}"
P="http://localhost:$PROXY_PORT"
TMP=$(mktemp -d)
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }

OLD_HOME=$(wp option get home); OLD_SITEURL=$(wp option get siteurl)
node "$DIR/cache-sim-proxy.js" "$PROXY_PORT" "$SITE_PORT" & PROXY=$!
cleanup() { wp option update home "$OLD_HOME" >/dev/null; wp option update siteurl "$OLD_SITEURL" >/dev/null; kill $PROXY 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
sleep 1
wp option update home "$P" >/dev/null; wp option update siteurl "$P" >/dev/null

echo "== Seed the cache: admin opens pages through the cache"
JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$P/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$P/wp-login.php"
for path in /notes/ '/?feed=rss2' /; do curl -4 -s -o /dev/null -b "$JAR" "$P$path"; done
code=$(curl -4 -s -o "$TMP/b" -w '%{http_code}' "$P/notes/")
[ "$code" = "200" ] && grep -q 'your hub is locked' "$TMP/b" && ok "simulation works: ordinary visitor gets the cached private page" || bad "simulation works" "$code"
code=$(curl -4 -s -o /dev/null -w '%{http_code}' -H 'Cache-Control: no-cache' "$P/notes/")
[ "$code" = "302" ] && ok "simulation works: no-cache request bypasses the cache (302)" || bad "simulation bypass" "$code"

echo "== Live check against the cached site"
wp eval 'foreach ( ContentPipeline\Self_Test::run()["results"] as $r ) { echo $r["state"], "|", $r["label"], "|", $r["text"], "\n"; }' > "$TMP/r"
sed 's/^/      /' "$TMP/r"
grep -q '^fail|Notes app|' "$TMP/r" && ok "Live check reports the cached Notes app" || bad "Live check reports the cached Notes app" "$(grep 'Notes app' $TMP/r)"
grep -q '^fail|Feed|' "$TMP/r" && ok "Live check reports the cached feed" || bad "Live check reports the cached feed" "$(grep 'Feed' $TMP/r)"
grep -q '^ok|Home page|' "$TMP/r" && ok "uncached home page still passes" || bad "uncached home page still passes" "$(grep 'Home page' $TMP/r)"
grep -qi 'cache' "$TMP/r" && ok "result mentions caching" || bad "result mentions caching" "no mention"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
