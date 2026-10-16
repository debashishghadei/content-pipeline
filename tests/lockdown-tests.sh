#!/bin/bash
# Lockdown tests for Content Pipeline Hub 0.1.x.
#
# Usage: tests/lockdown-tests.sh /path/to/content-pipeline-X.Y.Z.zip
# Needs: a WordPress test site served at $BASE, WP-CLI as `wp` pointed at it,
#        an "admin"/"admin" administrator. The site's debug.log is truncated at start.
set -u
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

echo "== Install plugin from $ZIP"
wp plugin deactivate content-pipeline >/dev/null 2>&1
rm -rf "$WP_DIR/wp-content/plugins/content-pipeline"
unzip -q "$ZIP" -d "$WP_DIR/wp-content/plugins/" || { echo "unzip failed"; exit 1; }
: > "$LOG"
wp plugin activate content-pipeline >/dev/null && ok "activate" || bad "activate" "wp-cli"
wp rewrite structure '/%postname%/' >/dev/null 2>&1
wp user get sub1 >/dev/null 2>&1 || wp user create sub1 sub1@example.com --role=subscriber --user_pass=sub1 >/dev/null

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
$A "$BASE/notes/"; expect_code "GET /notes/" 200; expect_body "app page content" "your hub is locked and ready"; expect_body "app stylesheet" "assets/css/app.css?ver="; expect_body "app has no theme head" "cp-app"
echo "$(hdr X-Robots-Tag)" | grep -q noindex && ok "X-Robots-Tag on app" || bad "X-Robots-Tag on app" "missing"
echo "$(hdr Cache-Control)" | grep -q 'no-store\|no-cache' && ok "app not cached" || bad "app not cached" "$(hdr Cache-Control)"
$A "$BASE/?cp_app=1"; expect_code "GET /?cp_app=1" 200
$A "$BASE/hello-world/"; expect_code "GET /hello-world/ (logged in)" 200
$A "$BASE/wp-admin/admin.php?page=content-pipeline"; expect_code "status page" 200; expect_body "status page content" "Privacy status"
$A "$BASE/wp-admin/plugins.php"; expect_body "Open notes link on Plugins screen" "Open notes"
$A "$BASE/wp-json/wp/v2/users/me"; expect_code "REST cookie without nonce" 401
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
$A -H "X-WP-Nonce: $NONCE" "$BASE/wp-json/wp/v2/users/me"; expect_code "REST with nonce" 200
$A -X POST --data 'action=heartbeat&_nonce=x' "$BASE/wp-admin/admin-ajax.php"; [ "$(code)" != "403" ] && ok "admin-ajax works when logged in ($(code))" || bad "admin-ajax works when logged in" "403"

echo "== Application password (for Phase 3 publishing)"
APW=$(wp user application-password create admin test-run --porcelain 2>/dev/null)
curl -4 -s -o "$TMP/body" -D "$TMP/head" -u "admin:$APW" "$BASE/wp-json/wp/v2/users/me"; expect_code "REST with application password" 200
wp user application-password delete admin --all >/dev/null 2>&1

echo "== Subscriber (logged in, no hub access)"
login sub1 sub1
[ "$(loc)" != "$BASE/notes/" ] && ok "subscriber not sent to notes" || bad "subscriber not sent to notes" "$(loc)"
$A "$BASE/"; expect_code "subscriber GET /" 403; no_leak "subscriber GET /"
$A "$BASE/notes/"; expect_code "subscriber GET /notes/" 403
NONCE=$(curl -4 -s -b "$JAR" "$BASE/wp-admin/admin-ajax.php?action=rest-nonce")
$A -H "X-WP-Nonce: $NONCE" "$BASE/wp-json/wp/v2/users/me"; expect_code "subscriber REST" 403

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

echo "== PHP log"
if [ -s "$LOG" ]; then bad "debug.log empty" "$(head -5 $LOG)"; else ok "debug.log empty (E_ALL)"; fi

echo
echo "Result: $PASS passed, $FAIL failed"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
