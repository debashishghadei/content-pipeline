#!/bin/bash
# Server-side regression tests for ChatGPT's review of 0.3.0:
#  1. Two saves of the same note at the same moment must not overwrite each other.
#  5. Note images must never be stored inside the public web folder.
#
# DISPOSABLE TEST SITES ONLY: creates notes, temporarily adds a must-use plugin that slows
# saves down (only for requests carrying a test header), removes private_html.
# Usage: CP_TEST_DISPOSABLE=1 tests/review-030-tests.sh
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
API="$BASE/wp-json/cp/v1"
TMP=$(mktemp -d)
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$BASE/wp-login.php"
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
post() { # path json [extra curl args...] -> stdout body
	local p="$1" d="$2"; shift 2
	curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' "$@" --data "$d" "$API/$p"
}

# Slows down the save step (after the version check) for requests with X-CP-Test-Delay.
MU="$WP_DIR/wp-content/mu-plugins/rig-cp-delay.php"
cat > "$MU" <<'PHP'
<?php
add_filter( 'wp_insert_post_data', function ( $data ) {
	if ( isset( $_SERVER['HTTP_X_CP_TEST_DELAY'] ) && 'cp_note' === $data['post_type'] ) {
		usleep( (int) $_SERVER['HTTP_X_CP_TEST_DELAY'] * 1000 );
	}
	return $data;
} );
PHP
trap 'rm -f "$MU"; rm -rf "$TMP"' EXIT

echo "== 1. Two saves of the same note at the same moment"
for round in 1 2 3; do
	ID=$(post notes "{\"client_id\":\"race$round$(date +%s%N | tail -c 9)\",\"title\":\"Race $round\",\"body\":\"start\"}" | jq -r .note.id)
	post "notes/$ID" '{"body":"from device A","base_version":1}' -H 'X-CP-Test-Delay: 1500' > "$TMP/a.json" &
	sleep 0.4
	post "notes/$ID" '{"body":"from device B","base_version":1}' > "$TMP/b.json"
	wait
	CA=$(jq -r '.conflict // false' "$TMP/a.json"); CB=$(jq -r '.conflict // false' "$TMP/b.json")
	FINAL=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/state" | jq -r --arg id "$ID" '.notes[] | select(.id == ($id|tonumber)) | .body')
	COPY=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/state" | jq -r --arg t "Race $round (conflict copy)" '.notes[] | select(.title == $t) | .body')
	if [ "$CA/$CB" = "false/true" ] || [ "$CA/$CB" = "true/false" ]; then ok "round $round: exactly one save reported as a conflict ($CA/$CB)"; else bad "round $round: exactly one conflict" "A=$CA B=$CB"; fi
	LOSER=$([ "$CA" = "true" ] && echo "from device A" || echo "from device B")
	WINNER=$([ "$CA" = "true" ] && echo "from device B" || echo "from device A")
	check "round $round: note keeps the save that won" "$FINAL" "$WINNER"
	check "round $round: the other text is kept as a conflict copy" "$COPY" "$LOSER"
done

echo "== 1b. Restoring an old version at the same moment as a save"
ID=$(post notes "{\"client_id\":\"racerestore$(date +%s%N | tail -c 9)\",\"title\":\"Race restore\",\"body\":\"v1 text\"}" | jq -r .note.id)
post "notes/$ID" '{"body":"v2 text","base_version":1}' > /dev/null
REV=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/notes/$ID/history" | jq -r '.versions[0].id')
post "notes/$ID/history/$REV/restore" '{}' -H 'X-CP-Test-Delay: 1500' > "$TMP/r.json" &
sleep 0.4
post "notes/$ID" '{"body":"v3 typed","base_version":2}' > "$TMP/u.json"
wait
VR=$(jq -r '.note.version' "$TMP/r.json"); CU=$(jq -r '.conflict // false' "$TMP/u.json")
FINAL=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/state" | jq -r --arg id "$ID" '.notes[] | select(.id == ($id|tonumber)) | .body')
HIST=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/notes/$ID/history" | jq -r '[.versions[].body] | join("|")')
COPYB=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" "$API/state" | jq -r '.notes[] | select(.title == "Race restore (conflict copy)") | .body')
if [ "$FINAL" = "v3 typed" ] || [ "$CU" = "true" ]; then ok "restore + save: the typed text is either the note or a conflict copy (final '$FINAL', conflict $CU)"; else bad "restore + save" "final '$FINAL', conflict $CU"; fi
echo "$FINAL|$HIST|$COPYB" | grep -q "v2 text" && ok "restore + save: 'v2 text' still kept somewhere (note, history or copy)" || bad "restore + save keeps v2" "final '$FINAL' history '$HIST' copy '$COPYB'"
echo "$FINAL|$HIST|$COPYB" | grep -q "v3 typed" && ok "restore + save: 'v3 typed' still kept somewhere" || bad "restore + save keeps v3" "final '$FINAL' history '$HIST' copy '$COPYB'"

echo "== 5. Images never stored in the public web folder"
PRIVATE="$(dirname "$WP_DIR")/private_html"
rm -rf "$PRIVATE"
ID=$(post notes "{\"client_id\":\"img$(date +%s%N | tail -c 9)\",\"title\":\"Image test\"}" | jq -r .note.id)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==' | base64 -d > "$TMP/a.png"
PUBLIC_DIR="$WP_DIR/wp-content/uploads/content-pipeline-private"
BEFORE=$(ls "$PUBLIC_DIR" 2>/dev/null | grep -c '\.png$')
CODE=$(curl -4 -s -o "$TMP/u.json" -w '%{http_code}' -b "$JAR" -H "X-WP-Nonce: $NONCE" -F "file=@$TMP/a.png;type=image/png" "$API/notes/$ID/files")
AFTER=$(ls "$PUBLIC_DIR" 2>/dev/null | grep -c '\.png$')
[ "$CODE" != "201" ] && ok "no private folder: upload refused ($CODE $(jq -r .code $TMP/u.json))" || bad "no private folder: upload refused" "201 accepted"
check "no private folder: no image written inside the website folder" "$AFTER" "$BEFORE"
mkdir -p "$PRIVATE"
CODE=$(curl -4 -s -o "$TMP/u.json" -w '%{http_code}' -b "$JAR" -H "X-WP-Nonce: $NONCE" -F "file=@$TMP/a.png;type=image/png" "$API/notes/$ID/files")
check "with private_html: upload works" "$CODE" 201
FID=$(jq -r .file.id "$TMP/u.json")
[ -f "$PRIVATE/content-pipeline-files/$FID.png" ] && ok "with private_html: image stored outside the website folder" || bad "stored in private_html" "missing"
rm -rf "$PRIVATE"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
