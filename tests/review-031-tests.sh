#!/bin/bash
# Upgrade test (ChatGPT review of 0.3.1): images that 0.2.0–0.3.0 stored in the public
# fallback folder keep working, are reported, and can be moved to the private folder.
#
# DISPOSABLE TEST SITES ONLY: creates and removes private_html next to the site and puts a
# test image into wp-content/uploads/content-pipeline-private.
# Usage: CP_TEST_DISPOSABLE=1 tests/review-031-tests.sh
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
API="$BASE/wp-json/cp/v1"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$BASE/wp-login.php"
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
STATUS="$BASE/wp-admin/admin.php?page=content-pipeline"

PRIVATE="$(dirname "$WP_DIR")/private_html"
LEGACY="$WP_DIR/wp-content/uploads/content-pipeline-private"
rm -rf "$PRIVATE"
mkdir -p "$LEGACY"
printf 'Require all denied\n' > "$LEGACY/.htaccess"; printf '<?php\n' > "$LEGACY/index.php"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==' | base64 -d > "$TMP/a.png"
FID=0123456789abcdef0123456789abcd01
cp "$TMP/a.png" "$LEGACY/$FID.png"
NID=$(curl -4 -s -b "$JAR" -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' --data "{\"client_id\":\"legacy$(date +%s%N | tail -c 9)\",\"title\":\"Old image note\"}" "$API/notes" | jq -r .note.id)
CP_NID=$NID CP_FID=$FID wp eval 'update_post_meta( (int) getenv( "CP_NID" ), "cp_files", array( array( "id" => getenv( "CP_FID" ), "name" => "a.png", "mime" => "image/png", "size" => 70, "w" => 2, "h" => 2 ) ) );'

echo "== Old public images, no private folder yet"
curl -4 -s -b "$JAR" "$STATUS" > "$TMP/s"
grep -q '1 image from an earlier version is still in the public folder' "$TMP/s" && ok "status page reports the old image" || bad "status reports old image" "missing"
grep -q 'first make sure the site has a private folder' "$TMP/s" && ok "status page explains what to do first" || bad "status explains" "missing"
grep -q 'value="content_pipeline_move_images"' "$TMP/s" && bad "no move button without a private folder" "button shown" || ok "no move button without a private folder"
check "old image still shows in the note" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/?cp_file=$FID")" 200
check "logged out: old image link still needs login" "$(curl -4 -s -o /dev/null -w '%{http_code}' "$BASE/?cp_file=$FID")" 302

echo "== Private folder available: move"
mkdir -p "$PRIVATE"
curl -4 -s -b "$JAR" "$STATUS" > "$TMP/s"
grep -q 'Move them to the private folder' "$TMP/s" && ok "move button offered" || bad "move button offered" "missing"
MNONCE=$(perl -0ne 'print $1 if /value="content_pipeline_move_images".*?name="_wpnonce" value="([^"]+)"/s' "$TMP/s")
check "move refuses a bad nonce" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" --data 'action=content_pipeline_move_images&_wpnonce=bad' "$BASE/wp-admin/admin-post.php")" 403
CODE=$(curl -4 -s -o /dev/null -D "$TMP/h" -w '%{http_code}' -b "$JAR" --data "action=content_pipeline_move_images&_wpnonce=$MNONCE&_wp_http_referer=/wp-admin/admin.php?page=content-pipeline" "$BASE/wp-admin/admin-post.php")
check "move runs" "$CODE/$(grep -c 'cp_images=done' $TMP/h)" "302/1"
[ -f "$PRIVATE/content-pipeline-files/$FID.png" ] && ok "image now in the private folder" || bad "image in private folder" "missing"
[ ! -e "$LEGACY" ] && ok "old public folder removed" || bad "old public folder removed" "$(ls -a $LEGACY)"
check "image still shows in the note after moving" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/?cp_file=$FID")" 200
curl -4 -s -b "$JAR" "$STATUS" | grep -q 'still in the public folder' && bad "warning gone after moving" "still shown" || ok "warning gone after moving"

ED=$(wp user get ed1 --field=ID 2>/dev/null || wp user create ed1 ed1@example.com --role=editor --user_pass=ed1 --porcelain)
EJAR="$TMP/ejar"
curl -4 -s -o /dev/null -c "$EJAR" "$BASE/wp-login.php"; curl -4 -s -o /dev/null -b "$EJAR" -c "$EJAR" --data 'log=ed1&pwd=ed1&testcookie=1' "$BASE/wp-login.php"
check "Editor cannot run the move" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$EJAR" --data 'action=content_pipeline_move_images&_wpnonce=x' "$BASE/wp-admin/admin-post.php")" 403
rm -rf "$PRIVATE"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
