# Handoff

Read this first when starting a new chat (Claude or ChatGPT). Update it at the end of every chat/milestone.

## Current state (16 Oct 2026)
- Version: **0.2.0** — the private hub (lockdown, 0.1.x) plus the notes app (Phase 1 except Google Keep import). Built and tested in the sandbox; not yet installed on the real hub.
- Review history: ChatGPT reviewed 0.1.0 (2 points, both confirmed and fixed in 0.1.1) and 0.1.1 (live check could miss a cache; confirmed, fixed in 0.1.2). ChatGPT recommends continuing with this plugin only.
- Full plan: project note "content-pipeline.md" (Claude project "Tools"); decisions in `DECISIONS.md` (D1–D22).

## What the app does (0.2.0)
- Notes with title, text, checklist, pin, status (Idea → Outline ready → Draft ready → Ready → Published), images.
- Folders like Windows Explorer (D14): Inbox + 4 website folders seeded (D15); nested folders; tree, tiles, breadcrumb; move by menu or drag and drop.
- Search (all folders or current folder), status filter, trash (30 days), history (D17), conflict copies (D18).
- Offline-safe saving via localStorage queue (D19); nonce renewal; logged-out banner.
- Protected images (`Files`), Ollama test page (`Ollama`).

## Files
- `content-pipeline.php` — header, constants, loads classes.
- `includes/class-plugin.php` — capability `cp_use_hub`, activation (registers + seeds), rewrite-rule rebuild after manual update.
- `includes/class-lockdown.php` — all privacy rules, login redirect, Remember me.
- `includes/class-notes.php` — post type `cp_note`, taxonomy `cp_folder`, seeding, folder rules, text cleaning, history helpers.
- `includes/class-api.php` — REST `cp/v1`: state, notes (create is idempotent via client_id; update with base_version), trash, history, files, folders.
- `includes/class-files.php` — image storage (private_html or fallback), `/?cp_file=ID` delivery after login.
- `includes/class-app.php` — `/notes/` page, home → notes, manifest `/?cp_manifest=1`.
- `includes/class-admin.php`, `includes/class-self-test.php` — status page and Live check.
- `includes/class-ollama.php` + `assets/js/ollama.js` — Ollama test page.
- `templates/app.php`, `assets/js/app.js` (the app, plain JS, no build), `assets/css/app.css`, `assets/icons/`.
- `bin/build.sh` — builds `dist/content-pipeline-X.Y.Z.zip` (tests/, bin/, docs excluded).

## Tests (disposable test sites only: `CP_TEST_DISPOSABLE=1`)
- `tests/lockdown-tests.sh ZIP` — privacy, users, login, live check, uninstall.
- `tests/cache-sim-tests.sh` — live check vs a misconfigured cache.
- `tests/notes-api-tests.sh` — API, folders, history, trash, images, uninstall keeps notes.
- `tests/app-tests.sh` — browser tests with Playwright/Chromium: desktop, phone, dark mode, plain permalinks, Ollama page with a fake Ollama. Needs `PW=<playwright path>`.
- Results for 0.2.0: `tests/reports/TEST-REPORT-0.2.0.md`.

## Next
- User: install 0.2.0 on a test site or the hub (SSL on, Varnish off, Permalinks "Post name"), press "Run check now", use the app on the Android phone for a few days, send feedback.
- Then Phase 2 (article workspace: Copy prompt / Paste result, prompts + style per site, Check), or Keep import if wanted first.

## Open issues / not tested
- Real Cloudways stack (Nginx + Apache + Varnish, private_html permissions), real Android phone (install to home screen, Back button), real Ollama on the user's PC.
- Very large note counts: the app loads all notes at start (fine for thousands of short notes).
- Images cannot be added while offline (by design, D19).
- `readme.html` and `license.txt` in the WordPress root reveal the WordPress version (harmless; can delete).
