#!/bin/bash
# ChatGPT review of 0.4.0, point 1: a failed article write must not be reported as saved,
# and the article's stage must not move when the write failed.
#
# DISPOSABLE TEST SITES ONLY: creates notes and articles; makes WordPress refuse article
# updates with a temporary test-only mu-plugin.
# Usage: CP_TEST_DISPOSABLE=1 tests/review-040-tests.sh
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
API="$BASE/wp-json/cp/v1"
TMP=$(mktemp -d)
MU="$WP_DIR/wp-content/mu-plugins/rig-cp-reject.php"
trap 'rm -f "$MU"; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$BASE/wp-login.php"
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
call() {
	local m="$1" p="$2" d="${3:-}"
	local data=(); [ -n "$d" ] && data=(-H 'Content-Type: application/json' --data "$d")
	CODE=$(curl -4 -s -o "$TMP/b" -w '%{http_code}' -X "$m" -b "$JAR" -H "X-WP-Nonce: $NONCE" "${data[@]}" "$API/$p")
}
j() { jq -r "$1" "$TMP/b"; }
rand() { echo "t$(date +%s%N | tail -c 12)$RANDOM"; }
reject_on()  { printf '%s\n' '<?php // Test only: WordPress refuses every update of an article.' "add_filter( 'wp_insert_post_empty_content', static function ( \$maybe, \$postarr ) { return ( 'cp_article' === ( \$postarr['post_type'] ?? '' ) && ! empty( \$postarr['ID'] ) ) ? true : \$maybe; }, 10, 2 );" > "$MU"; }
reject_off() { rm -f "$MU"; }
meta_stage() { CP_ID=$1 wp eval 'echo get_post_meta( (int) getenv( "CP_ID" ), "cp_stage", true );'; }
note_status() { CP_ID=$1 wp eval 'echo get_post_meta( (int) getenv( "CP_ID" ), "cp_status", true );'; }

call POST notes "{\"client_id\":\"$(rand)\",\"title\":\"Write failure\",\"body\":\"idea\"}"
NOTE=$(j .note.id)
call POST articles "{\"client_id\":\"$(rand)\",\"note\":$NOTE}"
ART=$(j .article.id)
call POST "articles/$ART" '{"field":"cleanup","value":"first text","base_rev":0}'
check "setup: cleanup saved (rev 1)" "$CODE/$(j .article.fields.cleanup.rev)" "200/1"

echo "== 1. Normal save while WordPress refuses the write"
reject_on
call POST "articles/$ART" '{"field":"cleanup","value":"second text","base_rev":1}'
if [ "$CODE" -ge 500 ]; then ok "refused write answered with an error ($CODE $(j .code))"; else bad "refused write answered with an error" "got $CODE (reported as saved)"; fi
reject_off
call GET "articles/$ART"
check "the stored text is unchanged" "$(j .article.fields.cleanup.value)/$(j .article.fields.cleanup.rev)" "first text/1"

echo "== 2. Conflict copy while WordPress refuses the write"
reject_on
call POST "articles/$ART" '{"field":"cleanup","value":"text from an old tab","base_rev":0}'
if [ "$CODE" -ge 500 ]; then ok "refused conflict copy answered with an error ($CODE)"; else bad "refused conflict copy answered with an error" "got $CODE, conflict=$(j .conflict) (copy not stored)"; fi
reject_off

echo "== 3. 'Ready' while WordPress refuses the write: the stage must not move"
call POST "articles/$ART" '{"field":"outline","value":[{"id":"sec1a","heading":"Why","brief":"b","words":200}],"base_rev":0}'
call POST "articles/$ART" '{"field":"approved","value":true,"base_rev":0}'
call POST "articles/$ART" '{"field":"section:sec1a","value":"Body text","base_rev":0}'
check "setup: stage draft_ready" "$(j .article.stage)" draft_ready
reject_on
call POST "articles/$ART" '{"field":"ready","value":true,"base_rev":0}'
if [ "$CODE" -ge 500 ]; then ok "refused 'ready' answered with an error ($CODE)"; else bad "refused 'ready' answered with an error" "got $CODE"; fi
check "stage still draft_ready" "$(meta_stage $ART)" draft_ready
check "note status not moved to ready" "$(note_status $NOTE)" draft_ready
reject_off
call GET "articles/$ART"
check "article reads draft_ready, ready not stored" "$(j .article.stage)/$(j '.article.fields.ready.value // "none"')" "draft_ready/none"

echo "== 4. Website change while WordPress refuses the write"
call GET state
SITE=$(j '.folders[] | select(.name=="Madhu Infotech") | .id')
reject_on
call POST "articles/$ART" "{\"site\":$SITE}"
if [ "$CODE" -ge 500 ]; then ok "refused website change answered with an error ($CODE)"; else bad "refused website change answered with an error" "got $CODE"; fi
reject_off
call GET "articles/$ART"
check "website unchanged" "$(j .article.site)" 0

echo "== 5. Works again after the problem is gone"
call POST "articles/$ART" '{"field":"cleanup","value":"second text","base_rev":1}'
check "save works, rev 2" "$CODE/$(j .article.fields.cleanup.value)/$(j .article.fields.cleanup.rev)" "200/second text/2"
call POST "articles/$ART" '{"field":"ready","value":true,"base_rev":0}'
check "ready works: stage + note" "$(j .article.stage)/$(note_status $NOTE)" "ready/ready"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
