# Content Pipeline Hub 0.1.2 — Test report

- Date: 16 Oct 2026
- Tested file: `content-pipeline-0.1.2.zip`, sha256 `bc80ac863cd8c2c0cedd3ffe473fb003c67fd43b4e58aee7fbead08f69c58713`, extracted and installed fresh by the test script
- Code commit: 7a3e416. Test scripts: `tests/lockdown-tests.sh`, `tests/cache-sim-tests.sh` (+ `tests/cache-sim-proxy.js`), same repo
- WordPress 7.1.3 on SQLite, Twenty Twenty-Five theme, PHP built-in web server
- PHP 8.4.26 and PHP 8.3.6, error reporting E_ALL, WP_DEBUG on

## Summary

| Check | PHP 8.4.26 | PHP 8.3.6 |
|---|---|---|
| `lockdown-tests.sh` | **194 passed, 0 failed** | **194 passed, 0 failed** |
| `cache-sim-tests.sh` | **6 passed, 0 failed** | **6 passed, 0 failed** |
| PHP warnings/notices/deprecations (debug.log + server log) | 0 | 0 |
| `php -l` on every PHP file in the zip | OK | OK |

WPCS 3.2: 0 errors, 0 warnings. Plugin Check 1.9.0: 1 item, intentional (`Update URI`, manual updates only, D10).

## ChatGPT review of 0.1.1 — verified before fixing

| Point | Verified? | Fix in 0.1.2 | Tests |
|---|---|---|---|
| Live check sends `Cache-Control: no-cache`, so it can miss a cache serving private pages | **Confirmed.** On 0.1.1 with a simulated cache (caches 200 answers by URL, obeys no-cache, adds no cache headers): an ordinary visitor got the private /notes/ page, yet all 8 live checks passed. | Visitor pages are requested twice with no bypass headers, then once with no-cache for comparison; if an ordinary answer is not the login redirect but the fresh one is, the row fails with "a cache is serving private pages", and "Page cache" fails too. REST is asked twice. A clean result is described as a spot check, not a guarantee (D13). | `cache-sim-tests.sh`: simulation proven (ordinary 200 / bypass 302), Notes app and Feed now fail, uncached Home page still passes. `lockdown-tests.sh` "Live check" section: 8 of 8 pass without a cache. |
| Test script uninstalls the plugin and deleted all application passwords for its test users, including admin | **Agreed.** | Both scripts refuse to run unless `CP_TEST_DISPOSABLE=1` is set. `lockdown-tests.sh` deletes only application passwords named `cp-test-run` that it created. | "other application passwords are kept" (a `keep-me` password on admin survives), "test application password removed"; run without the variable exits with code 2. |

## Run the tests (disposable test site only)

```
CP_TEST_DISPOSABLE=1 tests/lockdown-tests.sh /path/to/content-pipeline-0.1.2.zip
CP_TEST_DISPOSABLE=1 tests/cache-sim-tests.sh        # needs Node.js; uses port 8090
```
Both expect the site at http://localhost:8080 (`BASE`, `SITE_PORT` to change), WP-CLI as `wp`, and an admin/admin user.

## Not tested yet
- Real Cloudways stack (Nginx + Apache + Varnish), HTTPS cookies, real Android phone. After install, press **Run check now** on the status page.
- Multisite (not supported).

## Full results (PHP 8.4.26)

```
== Install plugin from /home/claude/rig/release/content-pipeline-0.1.2.zip
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
PASS  other application passwords are kept
PASS  test application password removed
== Admin keeps full wp-admin access
PASS  admin dashboard → 200
PASS  admin Posts screen → 200
PASS  admin sees drafts
PASS  admin profile → 200
PASS  admin new post screen → 200
== Subscriber 'sub1' (logged in, no hub access)
PASS  Subscriber can still log in (302)
PASS  Subscriber not sent to notes
PASS  Subscriber GET / → 403
PASS  Subscriber GET / shows no draft
PASS  Subscriber GET /notes/ → 403
PASS  Subscriber GET /notes/ shows no draft
PASS  Subscriber GET /?cp_app=1 → 403
PASS  Subscriber GET /?cp_app=1 shows no draft
PASS  Subscriber GET /hello-world/ → 403
PASS  Subscriber GET /hello-world/ shows no draft
PASS  Subscriber GET /wp-admin/ → 403
PASS  Subscriber GET /wp-admin/ shows no draft
PASS  Subscriber GET /wp-admin/index.php → 403
PASS  Subscriber GET /wp-admin/index.php shows no draft
PASS  Subscriber GET /wp-admin/edit.php?post_status=draft → 403
PASS  Subscriber GET /wp-admin/edit.php?post_status=draft shows no draft
PASS  Subscriber GET /wp-admin/edit.php → 403
PASS  Subscriber GET /wp-admin/edit.php shows no draft
PASS  Subscriber GET /wp-admin/post-new.php → 403
PASS  Subscriber GET /wp-admin/post-new.php shows no draft
PASS  Subscriber GET /wp-admin/profile.php → 403
PASS  Subscriber GET /wp-admin/profile.php shows no draft
PASS  Subscriber GET /wp-admin/upload.php → 403
PASS  Subscriber GET /wp-admin/upload.php shows no draft
PASS  Subscriber GET /wp-admin/media-new.php → 403
PASS  Subscriber GET /wp-admin/media-new.php shows no draft
PASS  Subscriber GET /wp-admin/edit-comments.php → 403
PASS  Subscriber GET /wp-admin/edit-comments.php shows no draft
PASS  Subscriber GET /wp-admin/tools.php → 403
PASS  Subscriber GET /wp-admin/tools.php shows no draft
PASS  Subscriber GET /wp-admin/admin.php?page=content-pipeline → 403
PASS  Subscriber GET /wp-admin/admin.php?page=content-pipeline shows no draft
PASS  Subscriber 403 page offers Log out
PASS  Subscriber POST admin-ajax heartbeat → 403
PASS  Subscriber GET admin-ajax rest-nonce → 403
PASS  Subscriber POST admin-ajax query-attachments → 403
PASS  Subscriber POST admin-post → 403
PASS  Subscriber POST async-upload → 403
PASS  Subscriber REST cookie without nonce → 401
PASS  Subscriber REST with application password → 403
PASS  Subscriber REST with application password shows no content
PASS  Subscriber Log out link works
PASS  Subscriber after logout: wp-admin → login → login screen
== Editor 'ed1' (logged in, no hub access)
PASS  Editor can still log in (302)
PASS  Editor not sent to notes
PASS  Editor GET / → 403
PASS  Editor GET / shows no draft
PASS  Editor GET /notes/ → 403
PASS  Editor GET /notes/ shows no draft
PASS  Editor GET /?cp_app=1 → 403
PASS  Editor GET /?cp_app=1 shows no draft
PASS  Editor GET /hello-world/ → 403
PASS  Editor GET /hello-world/ shows no draft
PASS  Editor GET /wp-admin/ → 403
PASS  Editor GET /wp-admin/ shows no draft
PASS  Editor GET /wp-admin/index.php → 403
PASS  Editor GET /wp-admin/index.php shows no draft
PASS  Editor GET /wp-admin/edit.php?post_status=draft → 403
PASS  Editor GET /wp-admin/edit.php?post_status=draft shows no draft
PASS  Editor GET /wp-admin/edit.php → 403
PASS  Editor GET /wp-admin/edit.php shows no draft
PASS  Editor GET /wp-admin/post-new.php → 403
PASS  Editor GET /wp-admin/post-new.php shows no draft
PASS  Editor GET /wp-admin/profile.php → 403
PASS  Editor GET /wp-admin/profile.php shows no draft
PASS  Editor GET /wp-admin/upload.php → 403
PASS  Editor GET /wp-admin/upload.php shows no draft
PASS  Editor GET /wp-admin/media-new.php → 403
PASS  Editor GET /wp-admin/media-new.php shows no draft
PASS  Editor GET /wp-admin/edit-comments.php → 403
PASS  Editor GET /wp-admin/edit-comments.php shows no draft
PASS  Editor GET /wp-admin/tools.php → 403
PASS  Editor GET /wp-admin/tools.php shows no draft
PASS  Editor GET /wp-admin/admin.php?page=content-pipeline → 403
PASS  Editor GET /wp-admin/admin.php?page=content-pipeline shows no draft
PASS  Editor 403 page offers Log out
PASS  Editor POST admin-ajax heartbeat → 403
PASS  Editor GET admin-ajax rest-nonce → 403
PASS  Editor POST admin-ajax query-attachments → 403
PASS  Editor POST admin-post → 403
PASS  Editor POST async-upload → 403
PASS  Editor REST cookie without nonce → 401
PASS  Editor REST with application password → 403
PASS  Editor REST with application password shows no content
PASS  Editor Log out link works
PASS  Editor after logout: wp-admin → login → login screen
== Login screen tools still work for visitors
PASS  lost password page → 200
PASS  lost password form
PASS  lost password request accepted
PASS  reset-password link handled by login screen
== Live check (status page button)
PASS  status page: not checked yet
PASS  status page: Protection enabled
PASS  live check runs
PASS  live check refuses a bad nonce
      ok Home page
      ok Notes app
      ok Feed
      ok REST API (users list)
      ok XML-RPC
      ok robots.txt
      ok Noindex header
      ok Page cache
PASS  live check: 8 of 8 passed
PASS  status page shows last check
PASS  status page shows run again
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

Result: 194 passed, 0 failed

== Seed the cache: admin opens pages through the cache
PASS  simulation works: ordinary visitor gets the cached private page
PASS  simulation works: no-cache request bypasses the cache (302)
== Live check against the cached site
      ok|Home page|Visitors are sent to the login screen.
      fail|Notes app|A normal visitor got a stored copy (answer 200) instead of the login screen; only a fresh request was sent to login. A cache is serving private pages: turn Varnish off for this app, purge all caches, then check again.
      fail|Feed|A normal visitor got a stored copy (answer 200) instead of the login screen; only a fresh request was sent to login. A cache is serving private pages: turn Varnish off for this app, purge all caches, then check again.
      ok|REST API (users list)|Blocked for visitors (answer 401).
      ok|XML-RPC|Blocked for visitors (answer 403).
      ok|robots.txt|Asks all crawlers to stay out.
      ok|Noindex header|Search engines are told not to index.
      fail|Page cache|A cache gave normal visitors a different answer than a fresh request (see the rows above). Turn Varnish off for this app (Cloudways → Application Settings), purge all caches, then run the check again.
PASS  Live check reports the cached Notes app
PASS  Live check reports the cached feed
PASS  uncached home page still passes
PASS  result mentions caching

Result: 6 passed, 0 failed
```
