# Changelog

All notable changes to Content Pipeline Hub. Versions follow semantic versioning (0.x while Phase 1 is built).

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
