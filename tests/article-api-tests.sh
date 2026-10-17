#!/bin/bash
# Server tests for articles and writing settings (0.4).
#
# DISPOSABLE TEST SITES ONLY: creates notes, articles and settings; changes writing settings
# of the "Madhu Infotech" folder; slows down saves with a temporary test-only mu-plugin.
# Usage: CP_TEST_DISPOSABLE=1 tests/article-api-tests.sh
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
LOG="$WP_DIR/wp-content/debug.log"
API="$BASE/wp-json/cp/v1"
TMP=$(mktemp -d)
MU="$WP_DIR/wp-content/mu-plugins/rig-cp-delay.php"
trap 'rm -f "$MU"; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$3', got '$2'"; fi; }
: > "$LOG"

JAR="$TMP/jar"
curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
curl -4 -s -o /dev/null -b "$JAR" -c "$JAR" --data 'log=admin&pwd=admin&testcookie=1' "$BASE/wp-login.php"
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
call() { # METHOD PATH [JSON] [extra curl args]
	local m="$1" p="$2" d="${3:-}"; shift 3 2>/dev/null || shift $#
	local data=(); [ -n "$d" ] && data=(-H 'Content-Type: application/json' --data "$d")
	CODE=$(curl -4 -s -o "$TMP/b" -w '%{http_code}' -X "$m" -b "$JAR" -H "X-WP-Nonce: $NONCE" "${data[@]}" "$@" "$API/$p")
}
j() { jq -r "$1" "$TMP/b"; }
rand() { echo "t$(date +%s%N | tail -c 12)$RANDOM"; }

call GET state
MADHU=$(j '.folders[] | select(.name=="Madhu Infotech") | .id')
INBOX=$(j .inbox)
[ -n "$MADHU" ] && ok "state lists articles ($(j '.articles | length'))" || bad "state" "no Madhu folder"

echo "== Permissions"
check "logged out: create refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{"note":1}' "$API/articles")" 401
check "logged out: settings refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' "$API/sites/0")" 401
wp user get ed1 >/dev/null 2>&1 || wp user create ed1 ed1@example.com --role=editor --user_pass=ed1 >/dev/null
EAPW=$(wp user application-password create ed1 cp-test-run --porcelain)
check "Editor (application password): articles refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -u "ed1:$EAPW" -X POST -H 'Content-Type: application/json' --data '{"note":1}' "$API/articles")" 403
check "Editor: settings refused" "$(curl -4 -s -o /dev/null -w '%{http_code}' -u "ed1:$EAPW" "$API/sites/0")" 403
for id in $(CP_U=ed1 CP_N=cp-test-run wp eval 'foreach ( WP_Application_Passwords::get_user_application_passwords( (int) get_user_by( "login", getenv( "CP_U" ) )->ID ) as $p ) { if ( $p["name"] === getenv( "CP_N" ) ) { echo $p["uuid"], "\n"; } }'); do wp user application-password delete ed1 "$id" >/dev/null; done

echo "== Create"
call POST notes "{\"client_id\":\"$(rand)\",\"title\":\"Salary talk\",\"body\":\"how to answer\",\"folder\":$MADHU}"
NOTE=$(j .note.id)
CID=$(rand)
call POST articles "{\"client_id\":\"$CID\",\"note\":$NOTE,\"site\":$MADHU}"
check "create: 201, linked to note and website, title from note" "$CODE/$(j .article.note)/$(j .article.site)/$(j .article.title)/$(j .article.stage)" "201/$NOTE/$MADHU/Salary talk/idea"
ART=$(j .article.id)
call POST articles "{\"client_id\":\"$CID\",\"note\":$NOTE,\"site\":$MADHU}"
check "same client_id again: same article, not a second one" "$CODE/$(j .created)/$(j .article.id)" "200/false/$ART"
call POST articles "{\"client_id\":\"$(rand)\",\"note\":999999}"
check "missing note refused" "$CODE" 404
call POST articles "{\"client_id\":\"$(rand)\",\"note\":$NOTE,\"site\":999999}"
check "unknown website → no website" "$(j .article.site)" 0
EXTRA=$(j .article.id)
check "article is private and has no front-end page" "$(wp post get $ART --field=post_status)/$(curl -4 -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/?p=$ART")" "private/404"

echo "== Fields, revisions, stage"
call POST "articles/$ART" '{"field":"cleanup","value":"- one\n- two","base_rev":0}'
check "save cleanup" "$CODE/$(j .conflict)/$(j .article.fields.cleanup.rev)" "200/false/1"
call POST "articles/$ART" '{"field":"nope","value":"x","base_rev":0}'
check "unknown field refused" "$CODE/$(j .code)" "400/cp_bad_field"
call POST "articles/$ART" '{"field":"outline","value":[{"id":"bad id","heading":"x"}],"base_rev":0}'
check "bad section id refused" "$CODE" 400
call POST "articles/$ART" '{"field":"approved","value":true,"base_rev":0}'
check "cannot approve an empty outline" "$CODE" 400
call POST "articles/$ART" '{"field":"outline","value":[{"id":"sec1a","heading":"Why","brief":"b","words":200},{"id":"sec2b","heading":"How","brief":"c","words":300}],"base_rev":0}'
call POST "articles/$ART" '{"field":"approved","value":true,"base_rev":0}'
check "approve: stage outline_ready, ids frozen" "$(j .article.stage)/$(j '.article.fields.approved.value.ids | join(",")')" "outline_ready/sec1a,sec2b"
call GET state
check "note status follows the article (Outline ready)" "$(j ".notes[] | select(.id==$NOTE) | .status")" outline_ready
call POST "articles/$ART" '{"field":"section:sec1a","value":"Text one","base_rev":0}'
check "one of two sections: still outline_ready" "$(j .article.stage)" outline_ready
call POST "articles/$ART" '{"field":"section:sec2b","value":"Text two","base_rev":0}'
check "all sections written: draft_ready" "$(j .article.stage)" draft_ready
call POST "articles/$ART" '{"field":"ready","value":true,"base_rev":0}'
check "marked ready" "$(j .article.stage)" ready
call POST "notes/$NOTE" '{"status":"idea"}'
call POST "articles/$ART" '{"field":"title","value":"Salary talk for freshers","base_rev":1}'
call GET state
check "note status only moves forward with the article (set back by hand stays)" "$(j ".notes[] | select(.id==$NOTE) | .status")" idea
check "title saved" "$(j ".articles[] | select(.id==$ART) | .title")" "Salary talk for freshers"
call POST "articles/$ART" '{"field":"published","value":true,"base_rev":0}'
check "marked published" "$(j .article.stage)" published
call POST "articles/$ART" '{"field":"seo","value":{"title":" Salary <b>talk</b> ","description":"d","slug":"Salary Talk!! For Freshers","keyword":"salary","excerpt":"e","extra":"x"},"base_rev":0}'
check "SEO cleaned (slug, no extra keys, text as typed)" "$(j '.article.fields.seo.value | [.slug, .title, (keys|length)] | @csv')" '"salary-talk-for-freshers","Salary <b>talk</b>",5'

echo "== Text stored exactly as typed"
TXT='<script>x</script> 50%20 back\\slash "q" ü 😀'
call POST "articles/$ART" "$(jq -n --arg t "$TXT" '{field:"polish", value:$t, base_rev:0}')"
check "polish text exact" "$(j .article.fields.polish.value)" "$TXT"

echo "== Versions and conflicts"
call POST "articles/$ART" '{"field":"cleanup","value":"- pasted answer","base_rev":1,"snapshot":true}'
check "paste keeps the old text as a version (replaced)" "$(j '.article.fields.cleanup.versions[0] | [.why,.value] | @csv')" '"replaced","- one
- two"'
call POST "articles/$ART" '{"field":"cleanup","value":"- typed a bit","base_rev":2}'
check "typing soon after: no new version (10-minute gap)" "$(j '.article.fields.cleanup.versions | length')" 1
call POST "articles/$ART" '{"field":"cleanup","value":"- from the other device","base_rev":1}'
check "stale save: conflict, text not overwritten" "$(j .conflict)/$(j .article.fields.cleanup.value)" "true/- typed a bit"
check "stale save kept as a version (from another device)" "$(j '.article.fields.cleanup.versions[0] | [.why,.value] | @csv')" '"conflict","- from the other device"'
for k in $(seq 1 12); do call POST "articles/$ART" "{\"field\":\"cleanup\",\"value\":\"v$k\",\"base_rev\":$((2+k)),\"snapshot\":true}"; done
check "at most 10 versions per field" "$(j '.article.fields.cleanup.versions | length')" 10

echo "== Two saves of the same field at the same moment (lock)"
cat > "$MU" <<'PHP'
<?php
add_filter( 'wp_insert_post_data', function ( $data ) {
	if ( isset( $_SERVER['HTTP_X_CP_TEST_DELAY'] ) && 'cp_article' === $data['post_type'] ) {
		usleep( (int) $_SERVER['HTTP_X_CP_TEST_DELAY'] * 1000 );
	}
	return $data;
} );
PHP
call GET "articles/$ART"; R=$(j .article.fields.polish.rev)
curl -4 -s -o "$TMP/a.json" -b "$JAR" -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' -H 'X-CP-Test-Delay: 1500' --data "{\"field\":\"polish\",\"value\":\"device A\",\"base_rev\":$R}" "$API/articles/$ART" &
sleep 0.4
curl -4 -s -o "$TMP/b.json" -b "$JAR" -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' --data "{\"field\":\"polish\",\"value\":\"device B\",\"base_rev\":$R}" "$API/articles/$ART"
wait
check "exactly one of the two is a conflict" "$(jq -r .conflict $TMP/a.json)/$(jq -r .conflict $TMP/b.json)" "false/true"
call GET "articles/$ART"
check "the other text is kept as a version" "$(j .article.fields.polish.value)/$(j '.article.fields.polish.versions[0].value')" "device A/device B"
rm -f "$MU"

echo "== Website of an article"
call POST "articles/$EXTRA" "{\"site\":$MADHU}"
check "change website" "$(j .article.site)" "$MADHU"

echo "== Trash"
call DELETE "articles/$EXTRA"
check "move to trash" "$CODE/$(j .article.trashed)" "200/true"
call POST "articles/$EXTRA" '{"field":"cleanup","value":"x","base_rev":0}'
check "editing a trashed article refused" "$CODE" 409
call GET trash
check "trash lists the article" "$(j "[.articles[] | select(.id==$EXTRA)] | length")" 1
call POST "articles/$EXTRA/restore"
check "restore" "$CODE/$(j .article.trashed)/$(wp post get $EXTRA --field=post_status)" "200/false/private"
call DELETE "articles/$EXTRA"; call DELETE "articles/$EXTRA"
check "delete again without force refused" "$CODE" 409
call DELETE "articles/$EXTRA?force=1"
check "delete forever" "$(j .deleted)" true
call GET "articles/$EXTRA"
check "gone for good" "$CODE" 404
call POST "articles" "{\"client_id\":\"$(rand)\",\"note\":$NOTE}"; E2=$(j .article.id)
call DELETE "articles/$E2"; call POST trash/empty
call GET "articles/$E2"
check "empty trash also deletes trashed articles" "$CODE" 404
call POST "notes/$NOTE" '{"pinned":true}'
call DELETE "notes/$NOTE"; call DELETE "notes/$NOTE?force=1"
call GET "articles/$ART"
check "deleting the note keeps its article" "$CODE/$(j .article.note_text)" "200/null"

echo "== Writing settings"
call GET "sites/$MADHU"; REV=$(j .settings.rev)
check "settings + default prompts + steps + boxes" "$(j '[.default_prompts.outline != null, (.steps|length), (.boxes|length)] | @csv')" 'true,6,7'
call POST "sites/$MADHU" "{\"settings\":{\"audience\":\"Freshers in India\",\"words\":99999,\"boxes\":[\"tip\",\"bogus\"],\"examples\":[{\"title\":\"A\",\"text\":\"Example text\"}],\"prompts\":{\"outline\":\"My outline prompt {{cleanup}}\",\"bogus\":\"x\"}},\"base_rev\":$REV}"
check "save settings (cleaned: words capped, unknown box/prompt dropped)" "$CODE/$(j '[.settings.audience, .settings.words, (.settings.boxes|join(",")), (.settings.prompts|keys|join(",")), .settings.examples[0].title] | @csv')" '200/"Freshers in India",10000,"tip","outline","A"'
call POST "sites/$MADHU" "{\"settings\":{\"audience\":\"x\"},\"base_rev\":$REV}"
check "stale settings save refused (409), nothing overwritten" "$CODE/$(j .code)" "409/cp_settings_changed"
call GET "sites/$MADHU"
check "settings unchanged after refused save" "$(j .settings.audience)" "Freshers in India"
call GET "sites/999999"
check "unknown folder: 404" "$CODE" 404
call GET "sites/0"
check "defaults (folder 0) readable" "$CODE" 200

echo "== Uninstall keeps articles"
COUNT=$(wp post list --post_type=cp_article --post_status=private --format=count)
cp -r "$WP_DIR/wp-content/plugins/content-pipeline" "$TMP/plugin-copy"
wp plugin deactivate content-pipeline >/dev/null && wp plugin uninstall content-pipeline >/dev/null
check "articles still there after uninstall" "$(wp post list --post_type=cp_article --post_status=private --format=count)" "$COUNT"
cp -r "$TMP/plugin-copy" "$WP_DIR/wp-content/plugins/content-pipeline"
wp plugin activate content-pipeline >/dev/null

echo "== PHP log"
if [ -s "$LOG" ]; then bad "debug.log empty" "$(head -5 $LOG)"; else ok "debug.log empty (E_ALL)"; fi
echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
