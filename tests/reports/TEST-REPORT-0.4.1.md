# Content Pipeline Hub 0.4.1 — Test report

- Date: 17 Oct 2026
- Tested file: `content-pipeline-0.4.1.zip`, sha256 `abc537c9fac2ed0d3326bf234d3c97dcb81b35ccce791ed41902bb086e3be4fb`, extracted and installed fresh by `lockdown-tests.sh`; the other suites ran on that installed copy
- Code commit: 90b3ccf (plugin), f2815c1 (tests). Test scripts in `tests/` (also delivered as content-pipeline-0.4.1-tests.zip)
- WordPress 7.1.3 on SQLite, PHP built-in web server with 4 workers, Chromium (Playwright 1.56)
- PHP 8.4.26 and PHP 8.3.6, error reporting E_ALL, WP_DEBUG on

## ChatGPT review of 0.4.0 — reproduced first, then fixed

| Point | Reproduced on 0.4.0? | Fix in 0.4.1 | Tests (0.4.0 → 0.4.1) |
|---|---|---|---|
| Failed article writes acknowledged as saved; a failed "ready" save still moves the stage | **Yes.** With WordPress refusing article updates (test mu-plugin, `wp_insert_post_empty_content`): normal save → 200; conflict copy not stored → 200 "conflict kept"; "ready" → 200, stage **and the note's status** moved to Ready. Also found: changing the article's website → 200 and the website changed although nothing was stored. In the browser the text disappeared from the waiting list and the app showed "Saved". | Every article write checks WordPress's answer. On failure: 500 `cp_article_update`; stage, note status and website unchanged (website meta restored). The app keeps the change waiting, never shows "Saved", and saves it once the problem is gone (D39). | review-040-tests.sh: 5 of 13 → 13 of 13. review-040-app.js scenario 1: 1 of 4 → 4 of 4 |
| A conflict response discards newer typing | **Yes**, exactly as described: the stored versions had only "version 1 + first typing"; the later typing was gone, nothing was waiting, the app showed saved. | Only the revision that was sent is cleared. On a conflict, later typing stays waiting on the old revision, so it is stored as an earlier version too (D40). | scenario 2: 5 of 6 → 6 of 6 |
| (found while testing point 2) Conflict while the text box has the focus | **Yes**, worse than reported: the box kept the old text, later typing ("B") was lost, and further typing ("C") then **replaced the other device's text** ("start A B C" became the current text). | The box shows the current text as soon as nothing typed there is waiting, also when it has the focus (everything typed is stored as an earlier version first) (D40). | scenario 2b: 0 of 4 → 4 of 4 |
| Suggestion: warn when draft sections change after polishing | Yes: Check and Copy to WordPress kept using the older polished text without any hint. | Polish, Check and Copy to WordPress say which text is used and name the sections changed after the polished text was saved; **Use the draft instead** / **Use the polished text**, saved with the article (`use_draft`). Both texts are kept (D41). | scenario 3: 1 of 10 (then crashed: no buttons) → 10 of 10 |

Old-version runs: server 5 passed / 8 failed; browser 8 passed / 9 failed and the rest could not run.

## Summary

| Suite | PHP 8.4.26 | PHP 8.3.6 |
|---|---|---|
| `lockdown-tests.sh` | **236 / 236** | **236 / 236** |
| `notes-api-tests.sh` | **84 / 84** | **84 / 84** |
| `app-tests.sh` → app-tests.js | **101 / 101** | **101 / 101** |
| `app-tests.sh` → review-030-app.js | **20 / 20** | **20 / 20** |
| `app-tests.sh` → review-031-app.js | **8 / 8** | **8 / 8** |
| `app-tests.sh` → review-032-app.js | **12 / 12** | **12 / 12** |
| `app-tests.sh` → article-app.js | **69 / 69** | **69 / 69** |
| `app-tests.sh` → blocks-tests.js | **33 / 33** | **33 / 33** |
| `app-tests.sh` → review-040-app.js (new) | **24 / 24** | **24 / 24** |
| `cache-sim-tests.sh` | **6 / 6** | **6 / 6** |
| `review-030-tests.sh` | **16 / 16** | **16 / 16** |
| `review-031-tests.sh` | **13 / 13** | **13 / 13** |
| `article-api-tests.sh` | **49 / 49** | **49 / 49** |
| `review-040-tests.sh` (new) | **13 / 13** | **13 / 13** |
| PHP warnings/notices/deprecations (debug.log + server log) | 0 | 0 |

Total 684 per PHP version. PHP 8.4: everything passed in one run. PHP 8.3: in the first run app-tests.js checked the search result immediately after a click (timing in the test, 2 fails); the check now waits up to 5 s for the result, and the whole browser suite then passed twice in a row.

WPCS 3.2: 0 errors, 0 warnings. Plugin Check 1.9.0: 1 item, intentional (`Update URI`, D10).

## Not tested yet
- Real Cloudways stack, real Android phone, real copy/paste with the ChatGPT and Claude apps, pasting the exported blocks into the Madhu Infotech site with Blog Kit.

## Full results of the new tests (PHP 8.4.26)

```
PASS  setup: cleanup saved (rev 1)
== 1. Normal save while WordPress refuses the write
PASS  refused write answered with an error (500 cp_article_update)
PASS  the stored text is unchanged
== 2. Conflict copy while WordPress refuses the write
PASS  refused conflict copy answered with an error (500)
== 3. 'Ready' while WordPress refuses the write: the stage must not move
PASS  setup: stage draft_ready
PASS  refused 'ready' answered with an error (500)
PASS  stage still draft_ready
PASS  note status not moved to ready
PASS  article reads draft_ready, ready not stored
== 4. Website change while WordPress refuses the write
PASS  refused website change answered with an error (500)
PASS  website unchanged
== 5. Works again after the problem is gone
PASS  save works, rev 2
PASS  ready works: stage + note

Result: 13 passed, 0 failed
```

```
== Article saving and stale polish (ChatGPT review of 0.4.0)
== 1. WordPress refuses the write: the text is not reported as saved
PASS  the change is still waiting (kept in the browser)
PASS  the app does not say "Saved"
PASS  nothing stored on the server (as expected while refusing)
PASS  after the problem is gone the text is saved
== 2. Conflict answer while more text was typed during the save
PASS  a save was on its way while typing (2 slowed)
PASS  the other device's text stays the current text
PASS  the later typing is kept (in Earlier versions)
PASS  nothing left waiting afterwards
PASS  the box shows the current text after the conflict
PASS  editing the shown text afterwards saves normally
== 2b. Same, but the box keeps the focus the whole time
PASS  the box still has the focus
PASS  the box now shows the current text
PASS  further typing builds on the other device's text
PASS  everything typed before is in Earlier versions
== 3. Draft changed after polishing
PASS  export says it uses the polished text, no warning yet
PASS  export warns that the draft changed after polishing
PASS  the warning names the changed section
PASS  check warns too
PASS  polish warns too
PASS  after "Use the draft" the export contains the corrected draft
PASS  the choice is saved with the article
PASS  the choice is remembered after reopening
PASS  switching back exports the polished text
PASS  no warning once the polished text is newer

Result: 24 passed, 0 failed
```

## Same tests on 0.4.0 (before the fixes)

```
PASS  setup: cleanup saved (rev 1)
== 1. Normal save while WordPress refuses the write
FAIL  refused write answered with an error  (got 200 (reported as saved))
PASS  the stored text is unchanged
== 2. Conflict copy while WordPress refuses the write
FAIL  refused conflict copy answered with an error  (got 200, conflict=true (copy not stored))
== 3. 'Ready' while WordPress refuses the write: the stage must not move
PASS  setup: stage draft_ready
FAIL  refused 'ready' answered with an error  (got 200)
FAIL  stage still draft_ready  (expected 'draft_ready', got 'ready')
FAIL  note status not moved to ready  (expected 'draft_ready', got 'ready')
FAIL  article reads draft_ready, ready not stored  (expected 'draft_ready/none', got 'ready/none')
== 4. Website change while WordPress refuses the write
FAIL  refused website change answered with an error  (got 200)
FAIL  website unchanged  (expected '0', got '321')
== 5. Works again after the problem is gone
PASS  save works, rev 2
PASS  ready works: stage + note

Result: 5 passed, 8 failed
```

```
== 1. WordPress refuses the write: the text is not reported as saved
FAIL  the change is still waiting (kept in the browser)  ({"pending":[],"sync":"saved"})
FAIL  the app does not say "Saved"  (saved)
PASS  nothing stored on the server (as expected while refusing)
FAIL  after the problem is gone the text is saved
== 2. Conflict answer while more text was typed during the save
PASS  a save was on its way while typing (1 slowed)
PASS  the other device's text stays the current text
FAIL  the later typing is kept (in Earlier versions)  (["from another device","version 1 + first typing","version 1"])
PASS  nothing left waiting afterwards
PASS  the box shows the current text after the conflict
PASS  editing the shown text afterwards saves normally
== 2b. Same, but the box keeps the focus the whole time
PASS  the box still has the focus
FAIL  the box now shows the current text  (start A B)
FAIL  further typing builds on the other device's text  (start A B C)
FAIL  everything typed before is in Earlier versions  (["start A","start"])
== 3. Draft changed after polishing
PASS  export says it uses the polished text, no warning yet
FAIL  export warns that the draft changed after polishing  (Copy for WordPressCopy as MarkdownCopy SEO fieldsHow to put it into WordPressOn your website: Posts → Add New Post.Type the post title: Stale polish 1792224256745Click into the empty text area below the title and paste. Headings, lists, tables, boxes and the FAQ appear as separate blocks.Put the SEO)
FAIL  test crashed: page.textContent: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('.cp-exported')[22m


Result: 8 passed, 9 failed
```

## Full results of all other suites (PHP 8.4.26)

```
== Install plugin from /home/claude/rig/release/content-pipeline-0.4.1.zip
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
== Private site OFF (normal website, notes still private)
PASS  off: home page public → 200
PASS  off: no noindex header on the website
PASS  off: post public → 200
PASS  off: post content shown
PASS  off: feed works → 200
PASS  off: normal REST API works → 200
PASS  off: robots.txt back to normal
PASS  off: XML-RPC as WordPress normally does → 200
PASS  off: notes app still needs login → login screen
PASS  off: notes app marked noindex
PASS  off: manifest still needs login → login screen
PASS  off: note images still need login → login screen
PASS  off: notes API still 401 → 401
PASS  off: admin login goes to the normal Dashboard
PASS  off: admin sees the normal home page (no redirect) → 200
PASS  off: admin opens notes → 200
PASS  off: notes page noindex for admin too
PASS  off: admin sees notes backup list → 200
PASS  off: status page says OFF
PASS  off: status page offers to turn it on
      ok Notes app
      ok App manifest
      ok Note images
      ok Notes API
      ok Noindex header
      ok Page cache
PASS  off: live check tests the notes only, 6 of 6 passed
PASS  off: Editor uses the dashboard normally → 200
PASS  off: Editor edits posts normally → 200
PASS  off: Editor cannot list notes → 403
PASS  off: no note titles for Editor
PASS  off: Editor cannot open the Content Pipeline page → 403
PASS  off: Editor cannot open notes → 403
PASS  off: Editor cannot open note images → 403
PASS  off: Editor admin-ajax works (200)
PASS  off: Editor notes API refused → 403
PASS  off: Editor normal REST API works → 200
PASS  off: Editor cannot flip the switch → 403
PASS  off: switch unchanged by Editor
== Switch on/off from the status page
PASS  switch refuses a bad nonce → 403
PASS  switch turns private site on
PASS  old live check cleared after switching
PASS  on again: website private → login screen
PASS  on: status page says ON
PASS  switch turns private site off
PASS  wp-config constant forces private on → login screen
PASS  status page says the switch is fixed in wp-config.php
PASS  back to private → login screen
== PHP log
PASS  debug.log empty (E_ALL)

Result: 236 passed, 0 failed
```

```
PASS  state loads
PASS  API answers are never cached (no-store)
PASS  5 starting folders (Inbox + 4 sites)
PASS  4 website folders
== Who may use the API
PASS  logged out: 401
PASS  logged out: create refused
PASS  subscriber (application password): 403
PASS  subscriber: create refused
== Create (safe to retry)
PASS  create: 201
PASS  create: folder, status, pin, version 1
PASS  same client_id again: no new note (200, created=false)
PASS  only one note exists
PASS  invalid client_id refused
PASS  unknown folder -> Inbox, unknown status -> idea
PASS  notes are private posts
== Text is stored exactly as typed
PASS  title exact
PASS  body exact (Windows line breaks -> \n, null byte removed)
PASS  checklist exact
PASS  exact even where admins' HTML is filtered (DISALLOW_UNFILTERED_HTML)
== Update, versions, conflicts
PASS  text change without base_version refused
PASS  update on current version
PASS  same text again: version unchanged
PASS  pin/status change needs no base_version, keeps version
PASS  stale version: conflict reported
PASS  stale version: original not overwritten
PASS  stale version: copy keeps the incoming text
PASS  move to missing folder refused
PASS  missing note: 404
== History (earlier text kept)
PASS  first change keeps the original text; second change within 10 min adds no copy
PASS  restore earlier version
PASS  text before restoring kept in history
PASS  a version of another note cannot be restored
== Folders
PASS  create folder
PASS  same name (any case) in same place refused
PASS  same name in another place allowed
PASS  empty name refused
PASS  missing parent refused
PASS  rename to a sibling's name refused
PASS  move a folder inside its own subfolder refused
PASS  Inbox cannot be moved
PASS  Inbox cannot be deleted
PASS  mark website folder
PASS  rename + move in one step
== Delete folder -> notes to trash -> restore to Inbox
PASS  delete folder with subfolder: 1 note trashed
PASS  folder and subfolder gone
PASS  note is in the trash
PASS  trash lists it, folder unknown
PASS  editing a trashed note refused
PASS  restored into the Inbox as a private note
== Trash, delete forever
PASS  move to trash
PASS  delete again without force refused
PASS  delete forever
PASS  gone for good
PASS  empty trash
== Images: private folder (Cloudways private_html)
PASS  uses private_html next to the site
PASS  upload PNG
PASS  file stored outside the public folder
PASS  size and dimensions recorded
PASS  PHP file disguised as .png refused
PASS  no stray files left after a refused upload
PASS  upload without a file refused
PASS  logged in: image served
PASS  image bytes identical
PASS  image headers: nosniff, sandbox, private cache
PASS  logged out: image link -> login screen
PASS  subscriber: image refused
PASS  bad file id: 404
PASS  unknown file id: 404
PASS  remove image
PASS  removed image deleted from disk
PASS  remove again: 404
PASS  deleting a note for good deletes its images
== Images: no private folder = images switched off (nothing stored in the website folder)
PASS  upload refused with a clear reason
PASS  no image written inside the website folder
PASS  status page says images are switched off
PASS  app is told images are off
PASS  with private_html: app is told images are on
== Manifest and app page
PASS  manifest for logged-in user
PASS  app page links the manifest with credentials
PASS  app page has its settings and script
PASS  a note containing </script> cannot break out of the page's script tag
== Uninstall keeps notes
PASS  notes still in the database after uninstall
PASS  after reinstall: same notes, Inbox reused (no duplicate folders)
== PHP log
PASS  debug.log empty (E_ALL)

Result: 84 passed, 0 failed
```

```
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

```
== 1. Two saves of the same note at the same moment
PASS  round 1: exactly one save reported as a conflict (false/true)
PASS  round 1: note keeps the save that won
PASS  round 1: the other text is kept as a conflict copy
PASS  round 2: exactly one save reported as a conflict (false/true)
PASS  round 2: note keeps the save that won
PASS  round 2: the other text is kept as a conflict copy
PASS  round 3: exactly one save reported as a conflict (false/true)
PASS  round 3: note keeps the save that won
PASS  round 3: the other text is kept as a conflict copy
== 1b. Restoring an old version at the same moment as a save
PASS  restore + save: the typed text is either the note or a conflict copy (final 'v1 text', conflict true)
PASS  restore + save: 'v2 text' still kept somewhere (note, history or copy)
PASS  restore + save: 'v3 typed' still kept somewhere
== 5. Images never stored in the public web folder
PASS  no private folder: upload refused (409 cp_file_storage)
PASS  no private folder: no image written inside the website folder
PASS  with private_html: upload works
PASS  with private_html: image stored outside the website folder

Result: 16 passed, 0 failed
== Old public images, no private folder yet
PASS  status page reports the old image
PASS  status page explains what to do first
PASS  no move button without a private folder
PASS  old image still shows in the note
PASS  logged out: old image link still needs login
== Private folder available: move
PASS  move button offered
PASS  move refuses a bad nonce
PASS  move runs
PASS  image now in the private folder
PASS  old public folder removed
PASS  image still shows in the note after moving
PASS  warning gone after moving
PASS  Editor cannot run the move

Result: 13 passed, 0 failed
```

```
== Reset notes on the test site
5 folders
== Start
PASS  login lands on /notes/
PASS  Inbox folder shown
PASS  site folder "Madhu Infotech" shown with website dot
PASS  site folder "happylife247" shown with website dot
PASS  site folder "Personal brand" shown with website dot
PASS  site folder "B2B tech" shown with website dot
PASS  sync shows saved at start
== Notes
PASS  note saved to server in Inbox
PASS  card shown
PASS  empty new note is not saved
PASS  HTML in notes is shown as text, never run
PASS  special characters stored exactly as typed
PASS  special characters shown exactly
PASS  notes still there after reload
== Edit, autosave
PASS  editor shows Saved after typing
PASS  autosave sent the text, version went up
== Checklist
PASS  checklist items, Enter adds item, tick saved
PASS  ticked items listed under "1 ticked item"
== Pin and status
PASS  Pinned section shown
PASS  status badge on card
PASS  status filter shows only matching notes
PASS  pin and status saved on server
== Folders
PASS  new folder inside Madhu Infotech (tile button)
PASS  breadcrumb shows Madhu Infotech › Interview prep
PASS  site badge shown for folder inside a website folder
PASS  duplicate folder name refused with a message
== Move note (menu)
PASS  editor shows new folder path
PASS  editor shows the website of the note (folder inside a website folder)
PASS  move saved on server
PASS  moved note left the Inbox view
== Drag and drop
PASS  drag a card onto a folder moves the note
PASS  drag a folder onto a folder moves the folder (with its notes)
PASS  a folder cannot be dropped inside its own subfolder
PASS  server also refuses moving a folder inside itself
== Search
PASS  search finds text in a subfolder and shows its folder path
PASS  search finds checklist text (all words)
PASS  search lists matching folders
PASS  search can be limited to the current folder
PASS  search in all folders again
== Offline
PASS  indicator shows Offline
PASS  offline text kept in this browser
PASS  card marks "not saved yet"
PASS  offline edit saved after the tab was closed and reopened online
PASS  note created offline saved after reopening
PASS  no duplicate notes
== Two devices editing the same note
PASS  other device saved first
PASS  conflict reported to the user
PASS  other device's text was not overwritten
PASS  this device's text saved as a conflict copy
PASS  editor switched to the copy
== Expired nonce and logged out
PASS  expired security token is renewed automatically
PASS  logged out: indicator says so
PASS  logged out: banner with Log in button
PASS  text typed while logged out saved after logging in again
== History
PASS  history lists earlier versions
PASS  restore brings back the earlier text
PASS  the text before restoring is kept in history
== Images
PASS  image added, served through the login gate
PASS  image loads for the logged-in user (private cache)
PASS  non-image file refused
PASS  card shows the image
== Trash
PASS  Undo brings a trashed note back
PASS  trash shows where the note came from
PASS  restore from trash
== Delete folder
PASS  delete asks first and says how many notes go to the trash
PASS  folder deleted, its note in the trash
PASS  trash says the folder is gone (restores to Inbox)
PASS  note from a deleted folder restored into the Inbox
PASS  Inbox cannot be deleted (no menu item)
== Delete forever, empty trash
PASS  deleting a note for good also deletes its image file
PASS  no JavaScript errors on desktop
PASS  no unexpected browser alert/confirm popups
== Visitors
PASS  logged out: image link goes to the login screen
PASS  logged out: manifest goes to the login screen
PASS  logged out: notes API answers 401
== Phone (Android size)
PASS  phone: round + button instead of the capture box
PASS  phone: folders hidden in a drawer
PASS  phone: menu button opens the folder drawer
PASS  phone: drawer closes after choosing a folder
PASS  phone: editor is full screen
PASS  phone: Back button closes the note (stays in the app)
PASS  phone: still on the notes page after Back
PASS  phone: new note saved in the open folder
PASS  phone: no sideways scrolling
PASS  phone: home-screen manifest (standalone, starts at /notes/)
PASS  phone: app icons load (192, 512, maskable)
PASS  no JavaScript errors on the phone
PASS  dark mode follows the device setting
== Ollama test page (fake Ollama)
PASS  Ollama page shows the exact OLLAMA_ORIGINS value
PASS  Ollama connected, models listed
PASS  test prompt answered, speed shown
PASS  blocked origin: clear explanation mentioning OLLAMA_ORIGINS
PASS  Ollama not running: clear explanation
== Images switched off (no private folder)
PASS  images off: the image button explains why
== Private site OFF (notes from the dashboard)
PASS  off: login goes to the Dashboard
PASS  off: home page stays the normal website
PASS  off: "Notes" link in the admin bar opens the app
PASS  off: notes save normally
PASS  off: no JavaScript errors
== Plain permalinks (?rest_route=)
PASS  plain permalinks: login lands on /?cp_app=1
PASS  plain permalinks: notes save

Result: 101 passed, 0 failed

== Saving and recovery (ChatGPT review of 0.3.0)
== 2. Unsent edit, note deleted on another device, tab reopened
PASS  deleted: unsent text kept in this browser
PASS  deleted: the unsent text was saved as a new note
PASS  deleted: nothing left waiting afterwards
PASS  deleted: the user is told
== 2. Unsent edit, note trashed on another device, tab reopened
PASS  trashed: unsent text kept in this browser
PASS  trashed: the unsent text was saved as a new note
PASS  trashed: nothing left waiting afterwards
PASS  trashed: the user is told
== 2b. Same, but the tab is simply reloaded (normal closing): taken over at once
PASS  reload: unsent text saved as a new note
PASS  reload: taken over at once (1013 ms)
== 3. A second tab must not erase the first tab's safety copy
PASS  tab A: unsent text kept in this browser
PASS  tab A's safety copy survives tab B saving its own (empty) state
PASS  tab A's safety copy survives tab B closing
PASS  tab A's text reaches the server when its connection is back
== 4. A save the server rejects is kept, shown, and can be retried
PASS  403: change still waiting (not dropped)
PASS  403: text still kept in this browser
PASS  403: indicator does not say saved
PASS  403: a lasting message explains it
PASS  403: still kept after reloading the page
PASS  403: "Try again" saves it once the server accepts it

Result: 20 passed, 0 failed

== Taking over safety copies when storage fails (ChatGPT review of 0.3.1)
== Tab A has unsent text, then goes away
PASS  tab A stored its safety copy
== Tab B takes over while its own writes fail (storage full)
PASS  old safety copy kept when the replacement could not be written
PASS  tab B holds the text and will save it
PASS  tab B shows a storage problem (not "saved")
PASS  trying again does not take the same copy twice
== Storage works again
PASS  replacement stored, then the old copy removed
PASS  the text reaches the server
PASS  no duplicate "(unsaved copy)" note

Result: 8 passed, 0 failed

== Same-tab record changes when storage fails (ChatGPT review of 0.3.2)
== Rescue of a note deleted elsewhere while storage is full (same tab)
PASS  1. unsaved text stored locally
PASS  2. another device deleted the note
PASS  3. the 404 queued a replacement note
PASS  4–5. storage full: the existing safety copy is kept
PASS  storage problem shown
PASS  storage works again + saved: no copies left over
PASS  the text is on the server exactly once
== A new note gets its server id while storage is full (record key changes)
PASS  new note stored locally (not yet on the server)
PASS  note created on the server; extra typing still waiting under the new key
PASS  storage full: the earlier copy is kept while the new-key copy cannot be written
PASS  after saving: no copies left over
PASS  all text reached the server

Result: 12 passed, 0 failed

== Article workspace (0.4)
PASS  test setup: writing settings saved
== Write article from a note
PASS  opens the workspace at #article=1476
PASS  title taken from the note
PASS  website taken from the note's folder
PASS  starts at step 1 Cleanup
== 1. Cleanup
PASS  Copy prompt puts the prompt on the clipboard
PASS  prompt has the website settings
PASS  prompt has the style guide and a piece of the example
PASS  prompt has the note; no unfilled placeholders
PASS  Paste answer fills the box
PASS  "Use as title" sets the article title
PASS  cleanup and title saved on the server
PASS  step 1 shows as done
== 2. Outline
PASS  outline prompt: target words, cleaned notes, FAQ rule
PASS  pasted outline read into 4 sections
PASS  edit and move a section: saved
PASS  Approve outline: stage Outline ready
PASS  the note's status follows (Outline ready)
== 3. Draft
PASS  4 section boxes
PASS  section prompt has its heading and the sections already written
PASS  section prompt offers section boxes only (no quick answer)
PASS  all sections written: stage Draft ready
PASS  word count per section
== 4. Polish
PASS  polish prompt: whole draft, phrases to avoid, all boxes
== 5. Check
PASS  check: [NEEDS DETAIL] left = must fix
PASS  check: phrase to avoid from the website settings found
PASS  Mark as ready (after confirming failed checks): stage Ready
== 6. SEO
PASS  SEO prompt has the article
PASS  Paste fills the 5 SEO fields (slug cleaned)
PASS  character counter
PASS  search result preview
PASS  SEO fields saved
== 7. Copy to WordPress
PASS  Copy for WordPress: block markup with Blog Kit boxes
PASS  no script in the copy or the preview
PASS  preview shows boxes and table
PASS  Mark as published: article and note Published
PASS  copied article: 39 blocks, all valid in the WordPress editor
== Earlier versions
PASS  earlier version listed after pasting a new answer
PASS  Restore brings it back
== Reload and Back
PASS  reload stays on the article and the last step
PASS  articles list shows it as Published
PASS  Back returns to the article
== Saving safety for article text
PASS  offline: article text kept in this browser
PASS  saved after the tab was closed and reopened online
PASS  conflict: the user is told
PASS  conflict: nothing overwritten, this tab's text kept as an earlier version
PASS  refused save: kept, with Try again / Copy text / Discard
PASS  refused save: indicator does not say saved
PASS  Try again saves it
== Writing settings screen
PASS  folder menu opens the website's writing settings
PASS  settings shown
PASS  unsaved changes shown
PASS  Save settings: tone, example, boxes saved
PASS  style guide prompt has all examples
PASS  style guide pasted and saved
PASS  custom prompt saved
PASS  stale settings save refused with a Reload button
PASS  the other change was not overwritten
== Custom prompt is used
PASS  the website's own cleanup prompt is used
== Trash
PASS  trashed article left the list
PASS  restored from the trash
== Note shows its article
PASS  note card shows it has an article
PASS  note editor links to the article and offers a new one
PASS  link opens the article
PASS  no JavaScript errors (desktop)
== Phone
PASS  phone: steps shown as a scrollable row
PASS  phone: no sideways scrolling
PASS  phone: outline editor usable
PASS  no JavaScript errors (phone)

Result: 69 passed, 0 failed

== Converter and block validity (0.4)
== Converter (Node)
PASS  pasted HTML is shown as text, never added as HTML
PASS  https links kept
PASS  javascript: links not turned into links
PASS  bold and italic
PASS  inline code
PASS  5 section headings (##)
PASS  ### becomes a level-3 heading
PASS  numbered list
PASS  wrapped list line joined to its item
PASS  Blog Kit boxes (quick answer, tip, warning, takeaways)
PASS  checklist box becomes a Blog Kit checklist
PASS  FAQ box becomes 2 Blog Kit FAQ blocks
PASS  FAQ question in summary
PASS  table
PASS  quote
PASS  [NEEDS DETAIL] kept visible
PASS  empty text gives no blocks
PASS  # is turned into ##
== Reading pasted answers (Node)
PASS  outline with ## / Brief / Words
PASS  numbered outline with (N words)
PASS  SEO lines read (bold labels, slug cleaned)
PASS  cleanup "Title:" line read
== Checks (Node)
PASS  check: [NEEDS DETAIL] left = fail
PASS  check: phrase to avoid found
PASS  check: sections ok
PASS  check: SEO lengths ok
PASS  check: empty section = fail
PASS  check: leftover Brief: / unclosed box = fail
PASS  check: no text = fail
== Prompt filling (Node)
PASS  placeholders filled, empty lines collapsed
== Validity in the real WordPress block editor
PASS  editor read 39 blocks (core/heading, core/paragraph, core/group, core/list, core/list-item, core/table, core/quote, core/details)
PASS  every block is valid in the editor
PASS  no "Classic" or missing blocks

Result: 33 passed, 0 failed

```
```
PASS  state lists articles (5)
== Permissions
PASS  logged out: create refused
PASS  logged out: settings refused
PASS  Editor (application password): articles refused
PASS  Editor: settings refused
== Create
PASS  create: 201, linked to note and website, title from note
PASS  same client_id again: same article, not a second one
PASS  missing note refused
PASS  unknown website → no website
PASS  article is private and has no front-end page
== Fields, revisions, stage
PASS  save cleanup
PASS  unknown field refused
PASS  bad section id refused
PASS  cannot approve an empty outline
PASS  approve: stage outline_ready, ids frozen
PASS  note status follows the article (Outline ready)
PASS  one of two sections: still outline_ready
PASS  all sections written: draft_ready
PASS  marked ready
PASS  note status only moves forward with the article (set back by hand stays)
PASS  title saved
PASS  marked published
PASS  SEO cleaned (slug, no extra keys, text as typed)
== Text stored exactly as typed
PASS  polish text exact
== Versions and conflicts
PASS  paste keeps the old text as a version (replaced)
PASS  typing soon after: no new version (10-minute gap)
PASS  stale save: conflict, text not overwritten
PASS  stale save kept as a version (from another device)
PASS  at most 10 versions per field
== Two saves of the same field at the same moment (lock)
PASS  exactly one of the two is a conflict
PASS  the other text is kept as a version
== Website of an article
PASS  change website
== Trash
PASS  move to trash
PASS  editing a trashed article refused
PASS  trash lists the article
PASS  restore
PASS  delete again without force refused
PASS  delete forever
PASS  gone for good
PASS  empty trash also deletes trashed articles
PASS  deleting the note keeps its article
== Writing settings
PASS  settings + default prompts + steps + boxes
PASS  save settings (cleaned: words capped, unknown box/prompt dropped)
PASS  stale settings save refused (409), nothing overwritten
PASS  settings unchanged after refused save
PASS  unknown folder: 404
PASS  defaults (folder 0) readable
== Uninstall keeps articles
PASS  articles still there after uninstall
== PHP log
PASS  debug.log empty (E_ALL)

Result: 49 passed, 0 failed
```
