# Decisions

Numbered decisions for Content Pipeline Hub. To change one, add a new line under it with the date, the change and why.

- **D1** — Runs as a WordPress plugin on its own private hub site (Cloudways subdomain of the personal domain), PHP 8.4. No n8n for now.
- **D2** — Private means access-controlled, not only noindex: every page, REST route and file needs login; noindex everywhere as well.
- **D3** — Hub permission is the capability `cp_use_hub`, granted at runtime to anyone with `manage_options` (nothing stored in the database). Later users/workers can be given it.
- **D4** — XML-RPC is blocked for everyone, including logged-in users (no use for it on the hub).
- **D5** — Notes app lives at `/notes/` (own template, no theme). The home page redirects there. Plain-permalinks fallback: `/?cp_app=1`.
- **D6** — Login-attempt limiting is NOT built in; the user adds it later with a plugin or snippet (decided 16 Oct 2026).
- **D7** — "Remember me" ticked by default, 30 days, for phone use.
- **D8** — Media Library files are NOT protected before 0.5; the status page warns. 0.5 stores attachments in Cloudways `private_html` behind a login-checked PHP gate (Nginx serves public files directly, so .htaccess is not reliable).
- **D9** — Proposed for 0.2 (open for review): notes stored as a private custom post type `cp_note` with a private label taxonomy and meta; revisions for earlier versions. Alternative: custom tables.
- **D10** — Manual updates (upload zip → "Replace current with uploaded"); `Update URI: false` blocks wordpress.org updates.
