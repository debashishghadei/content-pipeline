# Handoff

Read this first when starting a new chat (Claude or ChatGPT). Update it at the end of every chat/milestone.

## Current state (16 Oct 2026)
- Version: **0.1.0** (milestone 0.1 lockdown) — done, tested, not yet installed on the real hub.
- Tests: `tests/lockdown-tests.sh` — 95/95 pass on PHP 8.4.26 and 8.3.6 (WordPress 7.1.3, SQLite), run against the extracted release zip. WPCS clean. Plugin Check: only the intentional `Update URI` item.
- Full plan: project note "content-pipeline.md" (Claude project "Tools"); decisions in `DECISIONS.md`.

## Files
- `content-pipeline.php` — header, constants, loads classes.
- `includes/class-plugin.php` — capability `cp_use_hub`, activation, rewrite-rule rebuild after manual update.
- `includes/class-lockdown.php` — all privacy rules, login redirect, Remember me.
- `includes/class-app.php` — `/notes/` route and render; home → notes.
- `includes/class-admin.php` — status page, admin bar "Notes", plugin links.
- `templates/app.php`, `assets/css/app.css` — app shell.
- `bin/build.sh` — builds `dist/content-pipeline-X.Y.Z.zip` with `git archive` (tests/, bin/, docs excluded via .gitattributes).

## Next
- User: create the hub app on Cloudways (HTTPS on, Permalinks "Post name"), install 0.1.0, check the status page.
- Next milestone **0.2 Notes core** (see plan). Decide D9 (custom post type vs custom tables) first — reviewer input welcome.

## Open issues
- Not tested on the real Cloudways stack (Nginx + Apache, Breeze/Varnish). Varnish must not cache pages for logged-out visitors as "public": the plugin sends no-cache headers on redirects; check after install.
- `readme.html` and `license.txt` in the WordPress root are static files and still reveal the WordPress version (harmless; can delete them).
