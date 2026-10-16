#!/bin/bash
# Server-side tests for the notes API, folders, history, trash and protected images.
#
# DISPOSABLE TEST SITES ONLY: deletes ALL notes, folders and note images first, creates
# test users, may create a private_html folder next to the site, and runs an uninstall.
#
# Usage: CP_TEST_DISPOSABLE=1 tests/notes-api-tests.sh
# Needs: site at $BASE, WP-CLI as `wp`, admin/admin, jq, curl.
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
LOG="$WP_DIR/wp-content/debug.log"
API="$BASE/wp-json/cp/v1"
TMP=$(mktemp -d)
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }

: > "$LOG"
PRIVATE="$(dirname "$WP_DIR")/private_html"
rm -rf "$PRIVATE"

reset_notes() {
	wp eval '
	foreach ( get_posts( array( "post_type" => "cp_note", "post_status" => "any,trash", "posts_per_page" => -1, "fields" => "ids" ) ) as $id ) { wp_delete_post( $id, true ); }
	foreach ( get_terms( array( "taxonomy" => "cp_folder", "hide_empty" => false, "fields" => "ids" ) ) as $t ) { wp_delete_term( $t, "cp_folder" ); }
	delete_option( "content_pipeline_inbox" ); delete_option( "content_pipeline_seeded" );
	ContentPipeline\Notes::maybe_seed();' >/dev/null
}
reset_notes
wp user get sub1 >/dev/null 2>&1 || wp user create sub1 sub1@example.com --role=subscriber --user_pass=sub1 >/dev/null

# Admin session.
JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$BASE/wp-login.php"
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")

# call METHOD PATH [JSON]  -> body in $TMP/b, status in $CODE
call() {
	local data=()
	[ -n "${3:-}" ] && data=(-H 'Content-Type: application/json' --data "$3")
	CODE=$(curl -4 -s -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' -X "$1" -b "$JAR" -H "X-WP-Nonce: $NONCE" "${data[@]}" "$API/$2")
}
j() { jq -r "$1" "$TMP/b"; }

call GET state
INBOX=$(j .inbox)
MADHU=$(j '.folders[] | select(.name=="Madhu Infotech") | .id')
check "state loads" "$CODE" 200
grep -qi '^cache-control:.*no-store' "$TMP/h" && ok "API answers are never cached (no-store)" || bad "API no-store" "$(grep -i cache-control $TMP/h)"
check "5 starting folders (Inbox + 4 sites)" "$(j '.folders | length')" 5
check "4 website folders" "$(j '[.folders[] | select(.is_site)] | length')" 4

echo "== Who may use the API"
check "logged out: 401" "$(curl -4 -s -o /dev/null -w '%{http_code}' "$API/state")" 401
check "logged out: create refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{"title":"x"}' "$API/notes")" 401
SUBPW=$(wp user application-password create sub1 cp-test-run --porcelain)
check "subscriber (application password): 403" "$(curl -4 -s -o /dev/null -w '%{http_code}' -u "sub1:$SUBPW" "$API/state")" 403
check "subscriber: create refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -u "sub1:$SUBPW" -X POST -H 'Content-Type: application/json' --data '{"title":"x"}' "$API/notes")" 403

echo "== Create (safe to retry)"
call POST notes '{"client_id":"testclient0001","title":"One","body":"hello","folder":'"$MADHU"',"status":"ready","pinned":true}'
check "create: 201" "$CODE" 201
ID1=$(j .note.id)
check "create: folder, status, pin, version 1" "$(j '[.note.folder,.note.status,.note.pinned,.note.version] | @csv')" "$MADHU,\"ready\",true,1"
call POST notes '{"client_id":"testclient0001","title":"One again","body":"retry"}'
check "same client_id again: no new note (200, created=false)" "$CODE/$(j .created)/$(j .note.id)" "200/false/$ID1"
check "only one note exists" "$(wp post list --post_type=cp_note --post_status=private --format=count)" 1
call POST notes '{"client_id":"bad id!","title":"x"}'
check "invalid client_id refused" "$CODE" 400
call POST notes '{"title":"Weird","folder":999999,"status":"nonsense"}'
check "unknown folder -> Inbox, unknown status -> idea" "$(j '[.note.folder,.note.status] | @csv')" "$INBOX,\"idea\""
check "notes are private posts" "$(wp post get "$(j .note.id)" --field=post_status)" private

echo "== Text is stored exactly as typed"
TEXT='Tags <b>bold</b> & "quotes" '"'"'single'"'"' 50%20off back\\slash \\n literal ünïcödé 😀 <script>x</script>'
PAY=$(jq -n --arg t "$TEXT" '{title:$t, body:($t + "\r\nline2\u0000end"), client_id:"testclient0002", checklist:[{t:$t,d:true}]}')
call POST notes "$PAY"
ID2=$(j .note.id)
check "title exact" "$(j .note.title)" "$TEXT"
check "body exact (Windows line breaks -> \\n, null byte removed)" "$(j .note.body)" "$TEXT
line2end"
check "checklist exact" "$(j '.note.checklist[0].t')" "$TEXT"
echo "<?php define( 'DISALLOW_UNFILTERED_HTML', true );" > "$WP_DIR/wp-content/mu-plugins/rig-no-unfiltered.php"
call POST notes "$(jq -n --arg t "$TEXT" '{title:$t, body:$t, client_id:"testclient0003"}')"
check "exact even where admins' HTML is filtered (DISALLOW_UNFILTERED_HTML)" "$(j .note.title)|$(j .note.body)" "$TEXT|$TEXT"
rm -f "$WP_DIR/wp-content/mu-plugins/rig-no-unfiltered.php"

echo "== Update, versions, conflicts"
call POST "notes/$ID1" '{"body":"changed"}'
check "text change without base_version refused" "$CODE" 400
call POST "notes/$ID1" '{"body":"changed","base_version":1}'
check "update on current version" "$CODE/$(j .note.version)/$(j .note.body)" "200/2/changed"
call POST "notes/$ID1" '{"body":"changed","base_version":2}'
check "same text again: version unchanged" "$(j .note.version)" 2
call POST "notes/$ID1" '{"pinned":false,"status":"draft_ready"}'
check "pin/status change needs no base_version, keeps version" "$CODE/$(j .note.pinned)/$(j .note.status)/$(j .note.version)" "200/false/draft_ready/2"
call POST "notes/$ID1" '{"body":"from old device","base_version":1}'
check "stale version: conflict reported" "$CODE/$(j .conflict)" "200/true"
check "stale version: original not overwritten" "$(j .note.body)" changed
check "stale version: copy keeps the incoming text" "$(j .copy.title)|$(j .copy.body)|$(j .copy.folder)" "One (conflict copy)|from old device|$MADHU"
call POST "notes/$ID1" '{"folder":999999}'
check "move to missing folder refused" "$CODE" 404
call POST "notes/999999" '{"pinned":true}'
check "missing note: 404" "$CODE" 404

echo "== History (earlier text kept)"
call POST notes '{"client_id":"testclient0004","title":"H","body":"A"}'
H=$(j .note.id)
call POST "notes/$H" '{"body":"B","base_version":1}'
call POST "notes/$H" '{"body":"C","base_version":2}'
call GET "notes/$H/history"
check "first change keeps the original text; second change within 10 min adds no copy" "$(j '[.versions[].body] | join(",")')" "A"
REV=$(j '.versions[0].id')
call POST "notes/$H/history/$REV/restore"
check "restore earlier version" "$(j .note.body)/$(j .note.version)" "A/4"
call GET "notes/$H/history"
check "text before restoring kept in history" "$(j '[.versions[].body] | sort | join(",")')" "A,C"
call POST "notes/$ID1/history/$REV/restore"
check "a version of another note cannot be restored" "$CODE" 404

echo "== Folders"
call POST folders '{"name":"Interview prep","parent":'"$MADHU"'}'
check "create folder" "$CODE" 201
PREP=$(j .id)
call POST folders '{"name":"interview PREP","parent":'"$MADHU"'}'
check "same name (any case) in same place refused" "$CODE" 409
call POST folders '{"name":"Interview prep","parent":0}'
check "same name in another place allowed" "$CODE" 201
OTHER=$(j .id)
call POST folders '{"name":"   ","parent":0}'
check "empty name refused" "$CODE" 400
call POST folders '{"name":"x","parent":999999}'
check "missing parent refused" "$CODE" 404
call POST folders '{"name":"Freshers","parent":'"$PREP"'}'
FRESH=$(j .id)
call POST "folders/$OTHER" '{"name":"Inbox"}'
check "rename to a sibling's name refused" "$CODE" 409
call POST "folders/$MADHU" '{"parent":'"$FRESH"'}'
check "move a folder inside its own subfolder refused" "$CODE" 400
call POST "folders/$INBOX" '{"parent":'"$MADHU"'}'
check "Inbox cannot be moved" "$CODE" 400
call DELETE "folders/$INBOX"
check "Inbox cannot be deleted" "$CODE" 400
call POST "folders/$OTHER" '{"is_site":true}'
check "mark website folder" "$(j '.folders[] | select(.id=='"$OTHER"') | .is_site')" true
call POST "folders/$OTHER" '{"name":"Renamed","parent":'"$MADHU"'}'
check "rename + move in one step" "$(j '.folders[] | select(.id=='"$OTHER"') | [.name,.parent] | @csv')" "\"Renamed\",$MADHU"

echo "== Delete folder -> notes to trash -> restore to Inbox"
call POST notes '{"client_id":"testclient0005","title":"In freshers","folder":'"$FRESH"'}'
NF=$(j .note.id)
call DELETE "folders/$PREP"
check "delete folder with subfolder: 1 note trashed" "$CODE/$(j .trashed)" "200/1"
check "folder and subfolder gone" "$(j '[.folders[] | select(.id=='"$PREP"' or .id=='"$FRESH"')] | length')" 0
check "note is in the trash" "$(wp post get $NF --field=post_status)" trash
call GET trash
check "trash lists it, folder unknown" "$(j '.notes[] | select(.id=='"$NF"') | .folder_path')" ""
call POST "notes/$NF" '{"body":"x","base_version":1}'
check "editing a trashed note refused" "$CODE" 409
call POST "notes/$NF/restore"
check "restored into the Inbox as a private note" "$(j .note.folder)/$(wp post get $NF --field=post_status)" "$INBOX/private"

echo "== Trash, delete forever"
call DELETE "notes/$NF"
check "move to trash" "$CODE/$(j .note.trashed)" "200/true"
call DELETE "notes/$NF"
check "delete again without force refused" "$CODE" 409
call DELETE "notes/$NF?force=1"
check "delete forever" "$CODE/$(j .deleted)" "200/true"
call GET "notes/$NF/history"
check "gone for good" "$CODE" 404
call DELETE "notes/$ID2"
call POST trash/empty
check "empty trash" "$(j .deleted)" 1

echo "== Images: private folder (Cloudways private_html)"
mkdir -p "$PRIVATE"
FILES_DIR=$(wp eval 'echo ContentPipeline\Files::dir();')
check "uses private_html next to the site" "$FILES_DIR" "$PRIVATE/content-pipeline-files"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==' | base64 -d > "$TMP/a.png"
echo "<?php echo 'hi';" > "$TMP/fake.png"
upload() { CODE=$(curl -4 -s -o "$TMP/b" -w '%{http_code}' -b "$JAR" -H "X-WP-Nonce: $NONCE" -F "file=@$1;type=image/png" "$API/notes/$2/files"); }
upload "$TMP/a.png" "$ID1"
check "upload PNG" "$CODE" 201
FID=$(j .file.id)
FURL=$(j .file.url)
[ -f "$FILES_DIR/$FID.png" ] && ok "file stored outside the public folder" || bad "file stored outside the public folder" "$(ls $FILES_DIR)"
check "size and dimensions recorded" "$(j '[.file.w,.file.h,.file.mime] | @csv')" '2,2,"image/png"'
upload "$TMP/fake.png" "$ID1"
check "PHP file disguised as .png refused" "$CODE" 400
ls "$FILES_DIR" | grep -qv -e '\.png$' -e 'index.php' && bad "no stray files" "$(ls $FILES_DIR)" || ok "no stray files left after a refused upload"
CODE=$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" -H "X-WP-Nonce: $NONCE" -X POST "$API/notes/$ID1/files")
check "upload without a file refused" "$CODE" 400
CODE=$(curl -4 -s -o "$TMP/img" -D "$TMP/ih" -w '%{http_code}' -b "$JAR" "$FURL")
check "logged in: image served" "$CODE" 200
cmp -s "$TMP/img" "$TMP/a.png" && ok "image bytes identical" || bad "image bytes identical" "differ"
grep -qi '^x-content-type-options: nosniff' "$TMP/ih" && grep -qi "^content-security-policy: default-src 'none'; sandbox" "$TMP/ih" && grep -qi '^cache-control: private' "$TMP/ih" && ok "image headers: nosniff, sandbox, private cache" || bad "image headers" "$(cat $TMP/ih)"
CODE=$(curl -4 -s -o /dev/null -D "$TMP/ih" -w '%{http_code}' "$FURL")
check "logged out: image link -> login screen" "$CODE/$(grep -ci '^location: .*wp-login.php' $TMP/ih)" "302/1"
SJAR="$TMP/sjar"
curl -4 -s -o /dev/null -c "$SJAR" "$BASE/wp-login.php"; curl -4 -s -o /dev/null -b "$SJAR" -c "$SJAR" --data 'log=sub1&pwd=sub1&testcookie=1' "$BASE/wp-login.php"
check "subscriber: image refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$SJAR" "$FURL")" 403
check "bad file id: 404" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/?cp_file=../../wp-config")" 404
check "unknown file id: 404" "$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/?cp_file=0123456789abcdef0123456789abcdef")" 404
call DELETE "notes/$ID1/files/$FID"
check "remove image" "$CODE/$(j '.note.files | length')" "200/0"
[ ! -f "$FILES_DIR/$FID.png" ] && ok "removed image deleted from disk" || bad "removed image deleted" "still there"
call DELETE "notes/$ID1/files/$FID"
check "remove again: 404" "$CODE" 404
upload "$TMP/a.png" "$ID1"; FID=$(j .file.id)
call DELETE "notes/$ID1"; call DELETE "notes/$ID1?force=1"
[ ! -f "$FILES_DIR/$FID.png" ] && ok "deleting a note for good deletes its images" || bad "note delete removes images" "still there"

echo "== Images: no private folder = images switched off (nothing stored in the website folder)"
rm -rf "$PRIVATE"
PUBLIC_DIR="$WP_DIR/wp-content/uploads/content-pipeline-private"
BEFORE=$(ls "$PUBLIC_DIR" 2>/dev/null | grep -c '\.png$')
call POST notes '{"client_id":"testclient0006","title":"Img"}'
NI=$(j .note.id)
upload "$TMP/a.png" "$NI"
check "upload refused with a clear reason" "$CODE/$(j .code)" "409/cp_file_storage"
check "no image written inside the website folder" "$(ls "$PUBLIC_DIR" 2>/dev/null | grep -c '\.png$')" "$BEFORE"
curl -4 -s -b "$JAR" "$BASE/wp-admin/admin.php?page=content-pipeline" | grep -q 'Images are switched OFF' && ok "status page says images are switched off" || bad "status page images off" "no message"
curl -4 -s -b "$JAR" "$BASE/notes/" | grep -q '"images":false' && ok "app is told images are off" || bad "app images flag" "missing"
mkdir -p "$PRIVATE"
curl -4 -s -b "$JAR" "$BASE/notes/" | grep -q '"images":true' && ok "with private_html: app is told images are on" || bad "app images flag on" "missing"

echo "== Manifest and app page"
CODE=$(curl -4 -s -o "$TMP/m" -w '%{http_code}' -b "$JAR" "$BASE/?cp_manifest=1")
check "manifest for logged-in user" "$CODE/$(jq -r '.display + " " + .short_name' $TMP/m)" "200/standalone Notes"
curl -4 -s -b "$JAR" "$BASE/notes/" > "$TMP/app"
grep -q 'crossorigin="use-credentials"' "$TMP/app" && ok "app page links the manifest with credentials" || bad "manifest link" "missing"
grep -q '"nonce":"' "$TMP/app" && grep -q 'assets/js/app.js' "$TMP/app" && ok "app page has its settings and script" || bad "app page" "missing parts"
if grep -q '\\u003Cscript\\u003Ex\\u003C/script\\u003E' "$TMP/app" && ! grep -q '<script>x</script>' "$TMP/app"; then ok "a note containing </script> cannot break out of the page's script tag"; else bad "script tag escaping" "raw tag found"; fi

echo "== Uninstall keeps notes"
COUNT_BEFORE=$(wp post list --post_type=cp_note --post_status=private --format=count)
cp -r "$WP_DIR/wp-content/plugins/content-pipeline" "$TMP/plugin-copy"
wp plugin deactivate content-pipeline >/dev/null && wp plugin uninstall content-pipeline >/dev/null
check "notes still in the database after uninstall" "$(wp post list --post_type=cp_note --post_status=private --format=count)" "$COUNT_BEFORE"
cp -r "$TMP/plugin-copy" "$WP_DIR/wp-content/plugins/content-pipeline"
wp plugin activate content-pipeline >/dev/null
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
call GET state
check "after reinstall: same notes, Inbox reused (no duplicate folders)" "$(j '.notes | length')/$(j '[.folders[] | select(.name=="Inbox")] | length')" "$COUNT_BEFORE/1"

for id in $(wp eval 'foreach ( WP_Application_Passwords::get_user_application_passwords( get_user_by( "login", "sub1" )->ID ) as $p ) { if ( "cp-test-run" === $p["name"] ) { echo $p["uuid"], "\n"; } }'); do wp user application-password delete sub1 "$id" >/dev/null; done

echo "== PHP log"
if [ -s "$LOG" ]; then bad "debug.log empty" "$(head -5 $LOG)"; else ok "debug.log empty (E_ALL)"; fi
echo
echo "Result: $PASS passed, $FAIL failed"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
