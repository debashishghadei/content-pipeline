#!/bin/bash
# Lockdown tests for Content Pipeline Hub 0.1.x.
#
# DISPOSABLE TEST SITES ONLY. This script reinstalls and uninstalls the plugin, switches
# permalinks, creates test users (sub1, ed1) and a draft, empties debug.log, and creates
# temporary application passwords (it deletes only the ones it created).
#
# Usage: CP_TEST_DISPOSABLE=1 tests/lockdown-tests.sh /path/to/content-pipeline-X.Y.Z.zip
# Needs: a WordPress test site served at $BASE, WP-CLI as `wp` pointed at it,
#        an "admin"/"admin" administrator.
set -u
[ "${CP_TEST_DISPOSABLE:-}" = "1" ] || { echo "Refusing to run: set CP_TEST_DISPOSABLE=1 (disposable test site only)."; exit 2; }
ZIP="$1"
BASE="${BASE:-http://localhost:8080}"
WP_DIR="${WP_DIR:-/home/claude/rig/wp}"
LOG="$WP_DIR/wp-content/debug.log"
TMP=$(mktemp -d)
PASS=0
FAIL=0
C="curl -4 -s -o $TMP/body -D $TMP/head"

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1  ($2)"; }
code() { awk 'NR==1{print $2}' "$TMP/head"; }
loc()  { grep -i '^location:' "$TMP/head" | tr -d '\r' | cut -d' ' -f2-; }
hdr()  { grep -i "^$1:" "$TMP/head" | tr -d '\r' | cut -d' ' -f2-; }

expect_code() { # name expected-code
	local got; got=$(code)
	[ "$got" = "$2" ] && ok "$1 → $2" || bad "$1" "expected $2, got $got"
}
expect_login() { # name: 302 to wp-login.php
	local got l; got=$(code); l=$(loc)
	if [ "$got" = "302" ] && echo "$l" | grep -q 'wp-login.php'; then ok "$1 → login screen"; else bad "$1" "got $got $l"; fi
}
expect_body() { # name pattern
	grep -q "$2" "$TMP/body" && ok "$1" || bad "$1" "body lacks '$2'"
}
no_leak() { # name: body must not show site content
	if grep -qi -e 'Hello world' -e 'Sample Page' -e '"slug"' -e 'admin@example.com' "$TMP/body"; then bad "$1 leaks content" "content found in body"; else ok "$1 shows no content"; fi
}

# Delete only the application passwords this script created (name cp-test-run).
# UUIDs of a user's application passwords with a given name.
apw_ids() { # user name
	CP_U="$1" CP_N="$2" wp eval 'foreach ( WP_Application_Passwords::get_user_application_passwords( (int) get_user_by( "login", getenv( "CP_U" ) )->ID ) as $p ) { if ( $p["name"] === getenv( "CP_N" ) ) { echo $p["uuid"], "\n"; } }'
}
drop_test_apw() {
	for id in $(apw_ids "$1" cp-test-run); do
		wp user application-password delete "$1" "$id" >/dev/null 2>&1
	done
}

echo "== Install plugin from $ZIP"
wp plugin deactivate content-pipeline >/dev/null 2>&1
rm -rf "$WP_DIR/wp-content/plugins/content-pipeline"
unzip -q "$ZIP" -d "$WP_DIR/wp-content/plugins/" || { echo "unzip failed"; exit 1; }
: > "$LOG"
wp plugin activate content-pipeline >/dev/null && ok "activate" || bad "activate" "wp-cli"
wp rewrite structure '/%postname%/' >/dev/null 2>&1
wp user get sub1 >/dev/null 2>&1 || wp user create sub1 sub1@example.com --role=subscriber --user_pass=sub1 >/dev/null
wp user get ed1 >/dev/null 2>&1 || wp user create ed1 ed1@example.com --role=editor --user_pass=ed1 >/dev/null
[ -n "$(wp post list --post_status=draft --s='SECRET DRAFT TITLE' --format=ids)" ] || wp post create --post_title='SECRET DRAFT TITLE' --post_status=draft --post_author=1 >/dev/null
wp option delete content_pipeline_self_test >/dev/null 2>&1

echo "== Logged out"
for p in / /hello-world/ /sample-page/ /notes/ '/?cp_app=1' /feed/ '/?feed=rss2' /comments/feed/ '/?author=1' /author/admin/ /wp-sitemap.xml '/?s=hello' /wp-admin/ /2026/ '/?p=1'; do
	$C "$BASE$p"; expect_login "GET $p"; no_leak "GET $p"
done
for p in /wp-json/ /wp-json/wp/v2/users /wp-json/wp/v2/posts /wp-json/wp/v2/pages '/?rest_route=/wp/v2/users' '/wp-json/oembed/1.0/embed?url=http%3A%2F%2Flocalhost%3A8080%2Fhello-world%2F'; do
	$C "$BASE$p"; expect_code "REST $p" 401; no_leak "REST $p"
done
$C -X POST -H 'Content-Type: text/xml' --data '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>' "$BASE/xmlrpc.php"; expect_code "POST xmlrpc.php" 403
$C "$BASE/wp-links-opml.php"; expect_code "GET wp-links-opml.php" 403
$C -X POST --data 'comment_post_ID=1&comment=hi&author=x&email=x@example.com' "$BASE/wp-comments-post.php"; expect_code "POST wp-comments-post.php" 403
$C -X POST --data 'url=x&title=x' "$BASE/wp-trackback.php?p=1"; expect_code "POST wp-trackback.php" 403
$C -X POST --data 'action=heartbeat' "$BASE/wp-admin/admin-ajax.php"; expect_code "POST admin-ajax.php (nopriv)" 403
$C "$BASE/wp-admin/admin-post.php?action=anything"; expect_code "GET admin-post.php (nopriv)" 403
$C "$BASE/wp-signup.php"; expect_code "GET wp-signup.php" 403
$C "$BASE/wp-login.php"; expect_code "GET wp-login.php" 200; expect_body "login page ticks Remember me" "getElementById('rememberme')"
$C "$BASE/wp-login.php?action=register"; l=$(loc); echo "$l" | grep -q 'registration=disabled' && ok "registration disabled" || bad "registration disabled" "$(code) $l"
$C "$BASE/robots.txt"; expect_code "GET robots.txt" 200; grep -q 'Disallow: /$' "$TMP/body" && ok "robots.txt disallows all" || bad "robots.txt disallows all" "$(tr '\n' ' ' < $TMP/body)"
$C "$BASE/"; echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "X-Robots-Tag on redirect" || bad "X-Robots-Tag on redirect" "missing"
$C "$BASE/wp-json/"; echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "X-Robots-Tag on REST" || bad "X-Robots-Tag on REST" "missing"
$C "$BASE/wp-login.php"; echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "X-Robots-Tag on login" || bad "X-Robots-Tag on login" "missing"

echo "== Login as admin"
JAR="$TMP/jar"
login() { # user pass [redirect_to]
	rm -f "$JAR"
	curl -4 -s -o /dev/null -c "$JAR" "$BASE/wp-login.php"
	local extra=""; [ -n "${3:-}" ] && extra="--data-urlencode redirect_to=$3"
	curl -4 -s -o "$TMP/body" -D "$TMP/head" -b "$JAR" -c "$JAR" --data-urlencode "log=$1" --data-urlencode "pwd=$2" --data 'rememberme=forever&wp-submit=Log+In&testcookie=1' $extra "$BASE/wp-login.php"
}
login admin admin
[ "$(code)" = "302" ] && [ "$(loc)" = "$BASE/notes/" ] && ok "login → /notes/" || bad "login → /notes/" "$(code) $(loc)"
exp=$(grep -i '^set-cookie: wordpress_logged_in' "$TMP/head" | head -1 | sed -n 's/.*expires=\([^;]*\).*/\1/Ip')
days=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
[ "$days" -ge 29 ] && [ "$days" -le 30 ] && ok "Remember me cookie ≈ 30 days ($days)" || bad "Remember me cookie ≈ 30 days" "$days days"

login admin admin "$BASE/hello-world/"
[ "$(loc)" = "$BASE/hello-world/" ] && ok "login respects a requested page" || bad "login respects a requested page" "$(loc)"

login admin admin
A="curl -4 -s -o $TMP/body -D $TMP/head -b $JAR"
$A "$BASE/"; [ "$(code)" = "302" ] && [ "$(loc)" = "$BASE/notes/" ] && ok "home → /notes/" || bad "home → /notes/" "$(code) $(loc)"
$A "$BASE/notes/"; expect_code "GET /notes/" 200; expect_body "app page content" "id=\"cp-root\""; expect_body "app stylesheet" "assets/css/app.css?ver="; expect_body "app has no theme head" "cp-app"
echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "X-Robots-Tag on app" || bad "X-Robots-Tag on app" "missing"
echo "$(hdr Cache-Control)" | grep -q 'no-store\|no-cache' && ok "app not cached" || bad "app not cached" "$(hdr Cache-Control)"
$A "$BASE/?cp_app=1"; expect_code "GET /?cp_app=1" 200
$A "$BASE/hello-world/"; expect_code "GET /hello-world/ (logged in)" 200
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_code "status page" 200; expect_body "status page content" "Live check"
$A "$BASE/wp-admin/plugins.php"; expect_body "Open notes link on Plugins screen" "Open notes"
$A "$BASE/wp-json/wp/v2/users/me"; expect_code "REST cookie without nonce" 401
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
$A -H "X-WP-Nonce: $NONCE" "$BASE/wp-json/wp/v2/users/me"; expect_code "REST with nonce" 200
$A -X POST --data 'action=heartbeat&_nonce=x' "$BASE/wp-admin/admin-ajax.php"; [ "$(code)" != "403" ] && ok "admin-ajax works when logged in ($(code))" || bad "admin-ajax works when logged in" "403"

echo "== Application password (for Phase 3 publishing)"
apw_ids admin keep-me | grep -q . || wp user application-password create admin keep-me >/dev/null
APW=$(wp user application-password create admin cp-test-run --porcelain 2>/dev/null)
curl -4 -s -o "$TMP/body" -D "$TMP/head" -u "admin:$APW" "$BASE/wp-json/wp/v2/users/me"; expect_code "REST with application password" 200
drop_test_apw admin
apw_ids admin keep-me | grep -q . && ok "other application passwords are kept" || bad "other application passwords are kept" "keep-me deleted"
[ -z "$(apw_ids admin cp-test-run)" ] && ok "test application password removed" || bad "test application password removed" "still there"

echo "== Admin keeps full wp-admin access"
login admin admin
$A "$BASE/wp-admin/"; expect_code "admin dashboard" 200
$A "$BASE/wp-admin/edit.php?post_status=draft"; expect_code "admin Posts screen" 200; expect_body "admin sees drafts" "SECRET DRAFT TITLE"
$A "$BASE/wp-admin/profile.php"; expect_code "admin profile" 200
$A "$BASE/wp-admin/post-new.php"; expect_code "admin new post screen" 200

# Users who are logged in but have no hub permission (ChatGPT review of 0.1.0).
no_access_tests() { # user role
	local u="$1" r="$2"
	echo "== $r '$u' (logged in, no hub access)"
	login "$u" "$u"
	[ "$(code)" = "302" ] && ok "$r can still log in (302)" || bad "$r can still log in" "$(code)"
	[ "$(loc)" != "$BASE/notes/" ] && ok "$r not sent to notes" || bad "$r not sent to notes" "$(loc)"
	for p in / /notes/ '/?cp_app=1' /hello-world/ /wp-admin/ /wp-admin/index.php '/wp-admin/edit.php?post_status=draft' /wp-admin/edit.php /wp-admin/post-new.php /wp-admin/profile.php /wp-admin/upload.php /wp-admin/media-new.php /wp-admin/edit-comments.php /wp-admin/tools.php /wp-admin/admin.php?page=content-pipeline; do
		$A "$BASE$p"; expect_code "$r GET $p" 403
		grep -q 'SECRET DRAFT TITLE' "$TMP/body" && bad "$r GET $p leaks draft title" "found" || ok "$r GET $p shows no draft"
	done
	$A "$BASE/wp-admin/"; expect_body "$r 403 page offers Log out" "action=logout"
	$A -X POST --data 'action=heartbeat&_nonce=x&data[wp-refresh-post-lock][post_id]=5' "$BASE/wp-admin/admin-ajax.php"; expect_code "$r POST admin-ajax heartbeat" 403
	$A "$BASE/wp-admin/admin-ajax.php?action=rest-nonce"; expect_code "$r GET admin-ajax rest-nonce" 403
	$A -X POST --data 'action=query-attachments' "$BASE/wp-admin/admin-ajax.php"; expect_code "$r POST admin-ajax query-attachments" 403
	$A -X POST --data 'action=content_pipeline_self_test' "$BASE/wp-admin/admin-post.php"; expect_code "$r POST admin-post" 403
	$A -X POST "$BASE/wp-admin/async-upload.php"; expect_code "$r POST async-upload" 403
	$A "$BASE/wp-json/wp/v2/users/me"; expect_code "$r REST cookie without nonce" 401
	local apw; apw=$(wp user application-password create "$u" cp-test-run --porcelain 2>/dev/null)
	curl -4 -s -o "$TMP/body" -D "$TMP/head" -u "$u:$apw" "$BASE/wp-json/wp/v2/posts?status=draft"; expect_code "$r REST with application password" 403; no_leak "$r REST with application password"
	drop_test_apw "$u"
	# Log out using the link on the 403 page.
	$A "$BASE/wp-admin/"; local out; out=$(grep -o "href='[^']*action=logout[^']*'" "$TMP/body" | head -1 | sed "s/^href='//; s/'$//; s/&#038;/\&/g; s/&amp;/\&/g")
	curl -4 -s -o /dev/null -D "$TMP/head" -b "$JAR" -c "$JAR" "$out"
	echo "$(loc)" | grep -q 'loggedout=true' && ok "$r Log out link works" || bad "$r Log out link works" "$(code) $(loc)"
	$A "$BASE/wp-admin/"; expect_login "$r after logout: wp-admin → login"
}
no_access_tests sub1 Subscriber
no_access_tests ed1 Editor

echo "== Login screen tools still work for visitors"
$C "$BASE/wp-login.php?action=lostpassword"; expect_code "lost password page" 200; expect_body "lost password form" 'name="user_login"'
$C -X POST --data 'user_login=admin&wp-submit=Get+New+Password' "$BASE/wp-login.php?action=lostpassword"; [ "$(code)" = "302" ] && echo "$(loc)" | grep -q 'checkemail=confirm' && ok "lost password request accepted" || bad "lost password request accepted" "$(code) $(loc)"
$C "$BASE/wp-login.php?action=rp&key=x&login=admin"; [ "$(code)" = "302" ] && echo "$(loc)" | grep -q 'wp-login.php' && ok "reset-password link handled by login screen" || bad "reset-password link handled by login screen" "$(code) $(loc)"

echo "== Live check (status page button)"
login admin admin
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_body "status page: not checked yet" "Not checked yet"; expect_body "status page: Protection enabled" "Protection enabled"
SNONCE=$(perl -0ne 'print $1 if /value="content_pipeline_self_test".*?name="_wpnonce" value="([^"]+)"/s' "$TMP/body")
$A -X POST --data "action=content_pipeline_self_test&_wpnonce=$SNONCE&_wp_http_referer=/wp-admin/admin.php?page=content-pipeline" "$BASE/wp-admin/admin-post.php"; [ "$(code)" = "302" ] && ok "live check runs" || bad "live check runs" "$(code)"
$A -X POST --data "action=content_pipeline_self_test&_wpnonce=bad" "$BASE/wp-admin/admin-post.php"; [ "$(code)" = "403" ] && ok "live check refuses a bad nonce" || bad "live check refuses a bad nonce" "$(code)"
states=$(wp eval '$l = get_option("content_pipeline_self_test"); foreach ($l["results"] as $r) { echo $r["state"], " ", $r["label"], "\n"; }')
echo "$states" | sed 's/^/      /'
n=$(echo "$states" | grep -c .); nok=$(echo "$states" | grep -c '^ok ')
[ "$n" -eq 8 ] && [ "$nok" -eq 8 ] && ok "live check: 8 of 8 passed" || bad "live check: all passed" "$nok of $n"
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_body "status page shows last check" "Last checked"; expect_body "status page shows run again" "Run check again"

echo "== Plain permalinks"
wp rewrite structure '' >/dev/null 2>&1
login admin admin
[ "$(loc)" = "$BASE/?cp_app=1" ] && ok "plain: login → /?cp_app=1" || bad "plain: login → /?cp_app=1" "$(loc)"
$A "$BASE/?cp_app=1"; expect_code "plain: app" 200
wp rewrite structure '/%postname%/' >/dev/null 2>&1

echo "== Manual zip update (no activation hook) rebuilds /notes/ rule"
# Remove our rule first (this wp-cli run itself fires init), then mark the stored version as old.
wp eval '$r = get_option("rewrite_rules"); unset($r["^notes/?$"]); update_option("rewrite_rules", $r);' >/dev/null
wp eval 'echo isset(get_option("rewrite_rules")["^notes/?$"]) ? "present" : "absent";' | grep -q absent && ok "rule removed for test" || bad "rule removed for test" "still present"
wp option update content_pipeline_rules_version 0.0.0 >/dev/null
login admin admin
$A "$BASE/notes/"; expect_code "rule rebuilt on first request" 200
[ "$(wp option get content_pipeline_rules_version)" = "$(grep -m1 'Version:' $WP_DIR/wp-content/plugins/content-pipeline/content-pipeline.php | awk '{print $NF}')" ] && ok "rules version stored" || bad "rules version stored" "$(wp option get content_pipeline_rules_version)"

echo "== Deactivate / reactivate / uninstall"
wp plugin deactivate content-pipeline >/dev/null
$C "$BASE/hello-world/"; expect_code "deactivated: site public again" 200
$C "$BASE/notes/"; expect_code "deactivated: /notes/ gone" 404
wp option get content_pipeline_rules_version >/dev/null 2>&1 && bad "deactivate clears option" "still there" || ok "deactivate clears option"
wp plugin activate content-pipeline >/dev/null
$C "$BASE/hello-world/"; expect_login "reactivated: locked again"
login admin admin
$A "$BASE/notes/"; expect_code "reactivated: /notes/" 200
cp -r "$WP_DIR/wp-content/plugins/content-pipeline" "$TMP/plugin-copy"
wp plugin deactivate content-pipeline >/dev/null && wp plugin uninstall content-pipeline >/dev/null && ok "uninstall runs" || bad "uninstall runs" "wp-cli"
wp option get content_pipeline_rules_version >/dev/null 2>&1 && bad "uninstall removes option" "still there" || ok "uninstall removes option"
cp -r "$TMP/plugin-copy" "$WP_DIR/wp-content/plugins/content-pipeline"
wp plugin activate content-pipeline >/dev/null

echo "== Private site OFF (normal website, notes still private)"
wp option update content_pipeline_private 0 >/dev/null
$C "$BASE/"; expect_code "off: home page public" 200; [ -z "$(hdr X-Robots-Tag)" ] && ok "off: no noindex header on the website" || bad "off: no noindex header" "$(hdr X-Robots-Tag)"
$C "$BASE/hello-world/"; expect_code "off: post public" 200; expect_body "off: post content shown" "Hello world"
$C "$BASE/feed/"; expect_code "off: feed works" 200
$C "$BASE/wp-json/wp/v2/posts"; expect_code "off: normal REST API works" 200
$C "$BASE/robots.txt"; grep -q '^Disallow: /$' "$TMP/body" && bad "off: robots.txt normal" "still Disallow: /" || ok "off: robots.txt back to normal"
$C -X POST -H 'Content-Type: text/xml' --data '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>' "$BASE/xmlrpc.php"; expect_code "off: XML-RPC as WordPress normally does" 200
$C "$BASE/notes/"; expect_login "off: notes app still needs login"; echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "off: notes app marked noindex" || bad "off: notes noindex" "missing"
$C "$BASE/?cp_manifest=1"; expect_login "off: manifest still needs login"
$C "$BASE/?cp_file=00000000000000000000000000000000"; expect_login "off: note images still need login"
$C "$BASE/wp-json/cp/v1/state"; expect_code "off: notes API still 401" 401
login admin admin
echo "$(loc)" | grep -q '/wp-admin/$' && ok "off: admin login goes to the normal Dashboard" || bad "off: admin login goes to Dashboard" "$(loc)"
$A "$BASE/"; expect_code "off: admin sees the normal home page (no redirect)" 200
$A "$BASE/notes/"; expect_code "off: admin opens notes" 200; echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "off: notes page noindex for admin too" || bad "off: notes noindex (admin)" "missing"
$A "$BASE/wp-admin/edit.php?post_type=cp_note"; expect_code "off: admin sees notes backup list" 200
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_body "off: status page says OFF" "Private site: OFF"; expect_body "off: status page offers to turn it on" "Turn private site on"
SNONCE=$(perl -0ne 'print $1 if /value="content_pipeline_self_test".*?name="_wpnonce" value="([^"]+)"/s' "$TMP/body")
$A -X POST --data "action=content_pipeline_self_test&_wpnonce=$SNONCE&_wp_http_referer=/wp-admin/admin.php?page=content-pipeline" "$BASE/wp-admin/admin-post.php"
states=$(wp eval '$l = get_option("content_pipeline_self_test"); foreach ($l["results"] as $r) { echo $r["state"], " ", $r["label"], "\n"; }')
echo "$states" | sed 's/^/      /'
[ "$(echo "$states" | grep -c '^ok ')" -eq 6 ] && [ "$(echo "$states" | grep -c .)" -eq 6 ] && ok "off: live check tests the notes only, 6 of 6 passed" || bad "off: live check" "$states"
login ed1 ed1
$A "$BASE/wp-admin/"; expect_code "off: Editor uses the dashboard normally" 200
$A "$BASE/wp-admin/edit.php"; expect_code "off: Editor edits posts normally" 200
$A "$BASE/wp-admin/edit.php?post_type=cp_note"; expect_code "off: Editor cannot list notes" 403; grep -q 'SECRET\|Interview' "$TMP/body" && bad "off: no note titles for Editor" "found" || ok "off: no note titles for Editor"
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_code "off: Editor cannot open the Content Pipeline page" 403
$A "$BASE/notes/"; expect_code "off: Editor cannot open notes" 403
$A "$BASE/?cp_file=00000000000000000000000000000000"; expect_code "off: Editor cannot open note images" 403
$A -X POST --data 'action=heartbeat&_nonce=x' "$BASE/wp-admin/admin-ajax.php"; [ "$(code)" != "403" ] && ok "off: Editor admin-ajax works ($(code))" || bad "off: Editor admin-ajax" "403"
EAPW=$(wp user application-password create ed1 cp-test-run --porcelain 2>/dev/null)
curl -4 -s -o "$TMP/body" -D "$TMP/head" -u "ed1:$EAPW" "$BASE/wp-json/cp/v1/state"; expect_code "off: Editor notes API refused" 403
curl -4 -s -o "$TMP/body" -D "$TMP/head" -u "ed1:$EAPW" "$BASE/wp-json/wp/v2/posts?status=draft&context=edit"; expect_code "off: Editor normal REST API works" 200
drop_test_apw ed1
$A -X POST --data "action=content_pipeline_mode&private=1&_wpnonce=x" "$BASE/wp-admin/admin-post.php"; expect_code "off: Editor cannot flip the switch" 403
[ "$(wp option get content_pipeline_private)" = "0" ] && ok "off: switch unchanged by Editor" || bad "switch unchanged" "changed"

echo "== Switch on/off from the status page"
login admin admin
$A "$BASE/wp-admin/admin.php?page=content-pipeline"
MNONCE=$(perl -0ne 'print $1 if /value="content_pipeline_mode".*?name="_wpnonce" value="([^"]+)"/s' "$TMP/body")
$A -X POST --data "action=content_pipeline_mode&private=1&_wpnonce=bad" "$BASE/wp-admin/admin-post.php"; expect_code "switch refuses a bad nonce" 403
$A -X POST --data "action=content_pipeline_mode&private=1&_wpnonce=$MNONCE&_wp_http_referer=/wp-admin/admin.php?page=content-pipeline" "$BASE/wp-admin/admin-post.php"
[ "$(code)" = "302" ] && [ "$(wp option get content_pipeline_private)" = "1" ] && ok "switch turns private site on" || bad "switch on" "$(code) $(wp option get content_pipeline_private)"
wp option get content_pipeline_self_test >/dev/null 2>&1 && bad "old live check cleared after switching" "still there" || ok "old live check cleared after switching"
$C "$BASE/hello-world/"; expect_login "on again: website private"
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_body "on: status page says ON" "Private site: ON"
MNONCE=$(perl -0ne 'print $1 if /value="content_pipeline_mode".*?name="_wpnonce" value="([^"]+)"/s' "$TMP/body")
$A -X POST --data "action=content_pipeline_mode&private=0&_wpnonce=$MNONCE" "$BASE/wp-admin/admin-post.php"
[ "$(wp option get content_pipeline_private)" = "0" ] && ok "switch turns private site off" || bad "switch off" "$(wp option get content_pipeline_private)"
echo "<?php define( 'CONTENT_PIPELINE_PRIVATE', true );" > "$WP_DIR/wp-content/mu-plugins/rig-cp-private.php"
$C "$BASE/hello-world/"; expect_login "wp-config constant forces private on"
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_body "status page says the switch is fixed in wp-config.php" "fixed in wp-config.php"
rm -f "$WP_DIR/wp-content/mu-plugins/rig-cp-private.php"
wp option update content_pipeline_private 1 >/dev/null
$C "$BASE/hello-world/"; expect_login "back to private"

echo "== PHP log"
if [ -s "$LOG" ]; then bad "debug.log empty" "$(head -5 $LOG)"; else ok "debug.log empty (E_ALL)"; fi

echo
echo "Result: $PASS passed, $FAIL failed"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
