# Changelog

All notable changes to Content Pipeline Hub. Versions follow semantic versioning (0.x while Phase 1 is built).

## 0.3.1 — 2026-10-16

From ChatGPT's review of 0.3.0. All five points were reproduced with a test before fixing (tests/review-030-tests.sh, tests/review-030-app.js).

- **Fixed (high): two saves at the same moment could overwrite each other.** Reproduced: 3 of 3 rounds accepted both saves and lost one text; a history restore at the same moment as a save lost the typed text. Now every save and every history restore holds a per-note lock (an atomic row in the options table, works on MySQL/MariaDB and SQLite), re-reads the note fresh, then checks the version. The second save becomes a conflict copy. Locks left by crashed requests expire after 30 s; a save waiting more than 10 s gets 503 and the app retries.
- **Fixed (high): an unsent edit was lost if the note was deleted or trashed on another device before the tab was reopened.** Every safety copy now holds the whole note, so the text is rebuilt without the server and saved as a new note; the old copy is removed only after the new one is queued.
- **Fixed (high): a second tab could erase the first tab's safety copy.** Safety copies are now one record per tab and note; a tab never writes or deletes another tab's records. A tab that is gone (closed, reloaded, crashed) is recognised by its "alive" signal and its records are taken over by the next tab (at once after a normal close/reload, within ~15 s after a crash). Copies in the 0.3.0 format are taken over too.
- **Fixed (high): a save refused by the server (e.g. 403) was dropped and the app said "All changes saved".** Refused changes are now kept (also across reloads), the indicator says "Not saved – see the message", and a lasting red message offers **Try again** and **Save as new note**.
- **Fixed (privacy): images could be stored inside the public website folder when no private folder existed.** Images are now only accepted when the storage folder is outside the website (Cloudways private_html, or CONTENT_PIPELINE_FILES_DIR). Otherwise adding images is switched off, the image button explains why, and the status page says so.
- Also fixed while testing: during a reload Chrome fired "page hidden" after "page closing", which re-marked the closing tab as alive and delayed the takeover by ~15 s (no text lost).

## 0.3.0 — 2026-10-16

- New **"Private site" switch** on the Content Pipeline page (user request, to try the plugin on a normal site).
  - **ON** (default, for the hub): unchanged — the whole site is private.
  - **OFF**: the website works normally for everyone (pages, blog, comments, feeds, sitemaps, REST API, XML-RPC, search engines, Editors in wp-admin, normal login to the Dashboard, no home → notes redirect). **The notes stay private**: notes page, manifest, note images and notes API need an administrator; they are marked noindex and not page-cached (`DONOTCACHEPAGE`).
  - Can be fixed in wp-config.php with `define( 'CONTENT_PIPELINE_PRIVATE', true );` (or false); the page then shows it cannot be changed there.
  - Switching clears the last live check; the live check tests the notes only when the switch is OFF (6 checks) and the whole site when ON (8 checks).
- Notes and folders now have their own permissions (administrators only), so Editors cannot see notes in wp-admin even when the site is public.
- Admin menu: "Content Pipeline" opens the status page first ("Status & privacy").
- Tests: switch ON/OFF/fixed-by-constant, Editor in OFF mode, live check in OFF mode, browser test of the app from the Dashboard with the site public.

## 0.2.0 — 2026-10-16

The notes app (Phase 1, built in one go; Google Keep import left for later).

- **Notes:** quick "Take a note…" box (computer) / round + button (phone); title, text, checklists (Enter adds an item, ticked items move under "N ticked items"), pin, status (Idea → Outline ready → Draft ready → Ready → Published), status filter chips.
- **Folders like Windows Explorer** (no tags): folders inside folders, folder tree on the left, subfolder tiles and a clickable path at the top, create / rename / move / delete, "Move to…" for notes, drag and drop of notes and folders on a computer. Starts with Inbox + 4 website folders (Madhu Infotech, happylife247, Personal brand, B2B tech); any folder can be marked as a website folder, and notes inside it belong to that website (badge on cards).
- **Search** in all notes or only the current folder; also finds folders and checklist text; results show the folder path.
- **Reliable saving:** autosave while typing; every change is kept in the browser until the server confirms it; works offline and saves when the connection is back (also after closing and reopening the tab); "All changes saved / Saving… / Offline / Logged out" indicator; expired security token renewed automatically; logged-out banner with Log in button; nothing is lost.
- **Two devices:** an edit made on an older version never overwrites the newer one; it is saved as "(conflict copy)" and the user is told.
- **History:** earlier text is kept before changes (at most every 10 minutes, up to 50 versions); restore any version (the text before restoring is kept too).
- **Trash:** trash with Undo, restore (into the Inbox if its folder was deleted), delete forever, empty trash; deleted for good after 30 days. Deleting a folder moves its notes to the trash.
- **Protected images in notes:** stored outside the public folder (Cloudways private_html) when possible, shown only after login; phone photos are shrunk before upload; JPG/PNG/GIF/WebP only (checked on the server). Fallback folder with random names + deny rule when there is no private folder (status page warns).
- **Phone:** full-screen editor, Android Back closes a note, folder drawer, "Add to home screen" / Install app (manifest + icons), dark mode.
- **Ollama test page** (Content Pipeline → Ollama test): checks Ollama on the PC from the browser, lists models, runs a test prompt with speed, explains OLLAMA_ORIGINS / restart / Chrome local-network permission.
- Notes are private posts (type `cp_note`, folders = private taxonomy `cp_folder`); a backup list is under Content Pipeline → All notes. Notes are stored exactly as typed and always shown as text. Uninstalling the plugin keeps notes, folders and images.
- Fixed while testing: restoring an old version crashed (PHP by-reference argument); after a conflict the copy lost its "(conflict copy)" title; the Offline/Logged-out indicator flickered to "Saving…".
- Tests: new `tests/app-tests.sh` (browser, desktop + phone), `tests/notes-api-tests.sh` (server), fake Ollama helper.

## 0.1.2 — 2026-10-16

From ChatGPT's review of 0.1.1 (confirmed by test before fixing).

- Fixed: the Live check sent `Cache-Control: no-cache`, so a cache that obeys it was skipped. Reproduced with a simulated cache: a normal visitor got the private notes page while all 8 checks passed. Now each visitor page is requested twice like a normal visitor (no bypass headers) and once with no-cache for comparison; a different answer is reported as a cache serving private pages. The REST check is also asked twice. "Page cache: OK" now says it is a spot check, not a guarantee.
- Test scripts refuse to run unless `CP_TEST_DISPOSABLE=1` is set, and `lockdown-tests.sh` deletes only the application passwords it created (other passwords, e.g. on `admin`, are kept).
- New `tests/cache-sim-tests.sh` + `tests/cache-sim-proxy.js`: regression test with a misconfigured cache in front of the site.

## 0.1.1 — 2026-10-16

From ChatGPT's review of 0.1.0 (both points confirmed by test before fixing).

- Fixed: logged-in users without hub permission (e.g. Editor, Subscriber) could open wp-admin (dashboard, Posts screen with draft titles, profile) and use logged-in admin-ajax. Now every wp-admin screen, admin-ajax and admin-post request answers 403 for them, with a "Log out" link. Administrators, login, logout and password recovery are unchanged.
- Status page: rules are now listed as "Protection enabled" (settings), separate from a new **Live check** that requests the site as a logged-out visitor (home, notes, feed, REST, XML-RPC, robots.txt, noindex header, page-cache signals) and shows Passed / Failed / Needs attention. Shows "Not checked yet" until run.
- Tests: Subscriber and Editor regression tests across 15 front-end and admin URLs, admin-ajax, admin-post, async-upload, REST (cookie and application password), logout link; admin access, lost-password flow and live check covered.

## 0.1.0 — 2026-10-16

Milestone 0.1: lockdown.

- Whole site private: logged-out visitors are sent to the login screen (all pages, feeds, sitemaps, author pages, search).
- REST API (wp-json and ?rest_route=) needs login + hub permission (401/403 otherwise). Application passwords work.
- Blocked for logged-out visitors: comments, trackbacks, links OPML, post-by-email, sign-up/activate, admin-post and public admin-ajax actions. XML-RPC blocked for everyone (403).
- Forced off whatever the database says: search-engine visibility, user registration, comments, pings, sitemaps.
- `X-Robots-Tag: noindex, nofollow` on every response; robots.txt says `Disallow: /`.
- Hub permission `cp_use_hub` = administrators. Logged-in users without it get 403.
- After login you land on the notes app (`/notes/`, or `/?cp_app=1` with Plain permalinks); the home page redirects there. A page you asked for before logging in is respected.
- "Remember me" ticked by default and lasts 30 days.
- Notes app shell (own template, no theme, phone-first, light/dark).
- Status page (Content Pipeline menu): privacy checks, HTTPS and permalink warnings, uploads warning.
- Rewrite rules rebuild themselves after a manual zip update.
