# Content Pipeline Hub 0.1.0 — Test report

- Date: 16 Oct 2026
- Tested file: `content-pipeline-0.1.0.zip` (sha256 starts `e6ccde9691444059`), extracted and installed fresh by the test script
- Commit: 7c1bb1f
- WordPress 7.1.3 on SQLite, Twenty Twenty-Five theme, PHP built-in web server
- PHP 8.4.26 and PHP 8.3.6, error reporting E_ALL, WP_DEBUG on

## Summary

| Check | Result |
|---|---|
| `tests/lockdown-tests.sh` on PHP 8.4.26 | **95 passed, 0 failed** |
| `tests/lockdown-tests.sh` on PHP 8.3.6 | **95 passed, 0 failed** |
| PHP warnings/notices/deprecations (debug.log + server log, both versions) | 0 |
| `php -l` on every PHP file (8.4 and 8.3) | OK |
| WPCS 3.2 (WordPress standard, `phpcs.xml.dist`) | 0 errors, 0 warnings |
| Plugin Check 1.9.0 | 1 item, intentional: `Update URI` header (manual updates only, D10) |

## Found and fixed during this build
1. XML-RPC was blocked but answered "200" with an empty body (WordPress's XML-RPC error handler). Now answers a clear 403.
2. robots.txt: WordPress 7 no longer writes `Disallow: /` for hidden sites. The plugin now does.
3. (Test bug, not plugin) The rule-rebuild test triggered the rebuild during its own setup; test order fixed and a check added that the rule really was removed first.

## Not tested yet
- Real Cloudways stack (Nginx + Apache + Varnish), HTTPS cookies, real Android phone. To check after install (see HANDOFF.md).
- Multisite (not supported).

## Full results (PHP 8.4.26)

```
== Install plugin from /home/claude/rig/release/content-pipeline-0.1.0.zip
PASS  activate
== Logged out
PASS  GET / → login screen
PASS  GET / shows no content
PASS  GET /hello-world/ → login screen
PASS  GET /hello-world/ shows no content
PASS  GET /sample-page/ → login screen
PASS  GET /sample-page/ shows no content
PASS  GET /notes/ → login screen
PASS  GET /notes/ shows no content
PASS  GET /?cp_app=1 → login screen
PASS  GET /?cp_app=1 shows no content
PASS  GET /feed/ → login screen
PASS  GET /feed/ shows no content
PASS  GET /?feed=rss2 → login screen
PASS  GET /?feed=rss2 shows no content
PASS  GET /comments/feed/ → login screen
PASS  GET /comments/feed/ shows no content
PASS  GET /?author=1 → login screen
PASS  GET /?author=1 shows no content
PASS  GET /author/admin/ → login screen
PASS  GET /author/admin/ shows no content
PASS  GET /wp-sitemap.xml → login screen
PASS  GET /wp-sitemap.xml shows no content
PASS  GET /?s=hello → login screen
PASS  GET /?s=hello shows no content
PASS  GET /wp-admin/ → login screen
PASS  GET /wp-admin/ shows no content
PASS  GET /2026/ → login screen
PASS  GET /2026/ shows no content
PASS  GET /?p=1 → login screen
PASS  GET /?p=1 shows no content
PASS  REST /wp-json/ → 401
PASS  REST /wp-json/ shows no content
PASS  REST /wp-json/wp/v2/users → 401
PASS  REST /wp-json/wp/v2/users shows no content
PASS  REST /wp-json/wp/v2/posts → 401
PASS  REST /wp-json/wp/v2/posts shows no content
PASS  REST /wp-json/wp/v2/pages → 401
PASS  REST /wp-json/wp/v2/pages shows no content
PASS  REST /?rest_route=/wp/v2/users → 401
PASS  REST /?rest_route=/wp/v2/users shows no content
PASS  REST /wp-json/oembed/1.0/embed?url=http%3A%2F%2Flocalhost%3A8080%2Fhello-world%2F → 401
PASS  REST /wp-json/oembed/1.0/embed?url=http%3A%2F%2Flocalhost%3A8080%2Fhello-world%2F shows no content
PASS  POST xmlrpc.php → 403
PASS  GET wp-links-opml.php → 403
PASS  POST wp-comments-post.php → 403
PASS  POST wp-trackback.php → 403
PASS  POST admin-ajax.php (nopriv) → 403
PASS  GET admin-post.php (nopriv) → 403
PASS  GET wp-signup.php → 403
PASS  GET wp-login.php → 200
PASS  login page ticks Remember me
PASS  registration disabled
PASS  GET robots.txt → 200
PASS  robots.txt disallows all
PASS  X-Robots-Tag on redirect
PASS  X-Robots-Tag on REST
PASS  X-Robots-Tag on login
== Login as admin
PASS  login → /notes/
PASS  Remember me cookie ≈ 30 days (30)
PASS  login respects a requested page
PASS  home → /notes/
PASS  GET /notes/ → 200
PASS  app page content
PASS  app stylesheet
PASS  app has no theme head
PASS  X-Robots-Tag on app
PASS  app not cached
PASS  GET /?cp_app=1 → 200
PASS  GET /hello-world/ (logged in) → 200
PASS  status page → 200
PASS  status page content
PASS  Open notes link on Plugins screen
PASS  REST cookie without nonce → 401
PASS  REST with nonce → 200
PASS  admin-ajax works when logged in (200)
== Application password (for Phase 3 publishing)
PASS  REST with application password → 200
== Subscriber (logged in, no hub access)
PASS  subscriber not sent to notes
PASS  subscriber GET / → 403
PASS  subscriber GET / shows no content
PASS  subscriber GET /notes/ → 403
PASS  subscriber REST → 403
== Plain permalinks
PASS  plain: login → /?cp_app=1
PASS  plain: app → 200
== Manual zip update (no activation hook) rebuilds /notes/ rule
PASS  rule removed for test
PASS  rule rebuilt on first request → 200
PASS  rules version stored
== Deactivate / reactivate / uninstall
PASS  deactivated: site public again → 200
PASS  deactivated: /notes/ gone → 404
PASS  deactivate clears option
PASS  reactivated: locked again → login screen
PASS  reactivated: /notes/ → 200
PASS  uninstall runs
PASS  uninstall removes option
== PHP log
PASS  debug.log empty (E_ALL)

Result: 95 passed, 0 failed
```
