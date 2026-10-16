# Handoff

Read this first when starting a new chat (Claude or ChatGPT). Update it at the end of every chat/milestone.

## Current state (16 Oct 2026)
- Version: **0.3.3** — (0.3.3: no safety copy is removed before its replacement is stored, for every record-key change; 0.3.2: takeover fix + move button for old public images) — the private hub (lockdown, 0.1.x), the notes app (0.2.0, Phase 1 except Google Keep import), the "Private site" switch (0.3.0: OFF = normal website, notes still private) and the fixes from ChatGPT's review of 0.3.0 (0.3.1: per-note save lock, safer safety copies, refused saves kept, images only outside the website). Built and tested in the sandbox; not yet installed on a real site.
- Review history: ChatGPT reviewed 0.1.0 (2 points, both confirmed, fixed in 0.1.1), 0.1.1 (1 point, confirmed, fixed in 0.1.2) 0.3.0 (5 points, all confirmed by test, fixed in 0.3.1) 0.3.1 (1 point + upgrade note, confirmed, fixed in 0.3.2) and 0.3.2 (1 point, confirmed, fixed in 0.3.3; ChatGPT: ready for Cloudways testing with dummy notes; ChatGPT accepts localStorage with per-tab records and recommends: keep this implementation, test on Cloudways, Private site ON for the hub). ChatGPT recommends continuing with this plugin only. ChatGPT also listed what is still missing from the full plan (Phases 2–4: article workspace, prompts/style per site, sending drafts, receiver plugin, Ollama in buttons; Keep import) — known and planned.
- Full plan: project note "content-pipeline.md" (Claude project "Tools"); decisions in `DECISIONS.md` (D1–D31).

## What the app does (0.2.0+)
- Notes with title, text, checklist, pin, status (Idea → Outline ready → Draft ready → Ready → Published), images.
- Folders like Windows Explorer (D14): Inbox + 4 website folders seeded (D15); nested folders; tree, tiles, breadcrumb; move by menu or drag and drop.
- Search (all folders or current folder), status filter, trash (30 days), history (D17), conflict copies (D18).
- Offline-safe saving: per-tab localStorage records with the whole note (D26), per-note server lock (D25), refused saves kept with Try again (D27); nonce renewal; logged-out banner.
- Protected images (`Files`), Ollama test page (`Ollama`).
- "Private site" switch (D23): option `content_pipeline_private` ('0' = off), constant `CONTENT_PIPELINE_PRIVATE` overrides. `Plugin::is_private()`; `Lockdown::init()` registers the whole-site rules only when ON; `front_gate()` guards only notes requests when OFF.

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
- `tests/app-tests.sh` — browser tests with Playwright/Chromium: desktop, phone, dark mode, plain permalinks, images off, private site off, Ollama page with a fake Ollama, plus `review-030-app.js` (recovery, tabs, refused saves) `review-031-app.js` (storage failure during takeover) and `review-032-app.js` (storage failure during same-tab record changes). Needs `PW=<playwright path>`; creates private_html next to the site.
- `tests/review-030-tests.sh` — simultaneous saves/restores (slowed down by a temporary test-only mu-plugin) and image storage.
- `tests/review-031-tests.sh` — old public images: reported, still shown, moved by the button.
- Results: `tests/reports/TEST-REPORT-0.3.3.md` (and earlier reports).

## Next
- User: install 0.3.3 on the Madhu Infotech test site with the switch OFF (or on the hub with it ON: SSL on, Varnish off, Permalinks "Post name"), press "Run check now", use the app on the Android phone for a few days, send feedback.
- Then Phase 2 (article workspace: Copy prompt / Paste result, prompts + style per site, Check), or Keep import if wanted first.

## Open issues / not tested
- Real Cloudways stack (Nginx + Apache + Varnish, private_html permissions), real Android phone (install to home screen, Back button), real Ollama on the user's PC.
- Very large note counts: the app loads all notes at start (fine for thousands of short notes).
- Images cannot be added while offline (by design, D19), and are switched off unless a private folder outside the website exists (D28).
- Safety copies after a crash are taken over within ~15 s of reopening (after a normal close/reload: at once).
- `readme.html` and `license.txt` in the WordPress root reveal the WordPress version (harmless; can delete).
