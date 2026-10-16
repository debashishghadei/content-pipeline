# Handoff

Read this first when starting a new chat (Claude or ChatGPT). Update it at the end of every chat/milestone.

## Current state (16 Oct 2026)
- Version: **0.1.1** (milestone 0.1 lockdown + ChatGPT review fixes) — done, tested, not yet installed on the real hub.
- 0.1.1 fixed ChatGPT's review of 0.1.0: Editor/Subscriber could open wp-admin and logged-in admin-ajax (confirmed, fixed, D11); status page now separates "Protection enabled" from a real "Live check" (D12).
- Tests: `tests/lockdown-tests.sh` — 192/192 pass on PHP 8.4.26 and 8.3.6 (WordPress 7.1.3, SQLite), run against the extracted release zip. WPCS clean. Plugin Check: only the intentional `Update URI` item.
- Full plan: project note "content-pipeline.md" (Claude project "Tools"); decisions in `DECISIONS.md`.

## Files
- `content-pipeline.php` — header, constants, loads classes.
- `includes/class-plugin.php` — capability `cp_use_hub`, activation, rewrite-rule rebuild after manual update.
- `includes/class-lockdown.php` — all privacy rules, login redirect, Remember me.
- `includes/class-app.php` — `/notes/` route and render; home → notes.
- `includes/class-admin.php` — status page (Live check / Protection enabled / Setup), admin bar "Notes", plugin links.
- `includes/class-self-test.php` — Live check: loopback requests as a logged-out visitor, result in option `content_pipeline_self_test`.
- `templates/app.php`, `assets/css/app.css` — app shell.
- `bin/build.sh` — builds `dist/content-pipeline-X.Y.Z.zip` with `git archive` (tests/, bin/, docs excluded via .gitattributes).

## Next
- User: create the hub app on Cloudways (HTTPS on, Varnish off, Permalinks "Post name"), install 0.1.1, press "Run check now" on the status page.
- Next milestone **0.2 Notes core** (see plan). Decide D9 (custom post type vs custom tables) first — reviewer input welcome.

## Open issues
- Not tested on the real Cloudways stack (Nginx + Apache, Breeze/Varnish). The Live check on the status page verifies this after install.
- `readme.html` and `license.txt` in the WordPress root are static files and still reveal the WordPress version (harmless; can delete them).
