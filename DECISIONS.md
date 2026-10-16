# Decisions

Numbered decisions for Content Pipeline Hub. To change one, add a new line under it with the date, the change and why.

- **D1** — Runs as a WordPress plugin on its own private hub site (Cloudways subdomain of the personal domain), PHP 8.4. No n8n for now.
- **D2** — Private means access-controlled, not only noindex: every page, REST route and file needs login; noindex everywhere as well.
- **D3** — Hub permission is the capability `cp_use_hub`, granted at runtime to anyone with `manage_options` (nothing stored in the database). Later users/workers can be given it.
- **D4** — XML-RPC is blocked for everyone, including logged-in users (no use for it on the hub).
- **D5** — Notes app lives at `/notes/` (own template, no theme). The home page redirects there. Plain-permalinks fallback: `/?cp_app=1`.
- **D6** — Login-attempt limiting is NOT built in; the user adds it later with a plugin or snippet (decided 16 Oct 2026).
- **D7** — "Remember me" ticked by default, 30 days, for phone use.
- **D8** — Media Library files are NOT protected; the status page warns. Note images are stored in Cloudways `private_html` behind a login-checked PHP gate (Nginx serves public files directly, so .htaccess is not reliable). See D28.
- **D9** — Proposed for 0.2 (open for review): notes stored as a private custom post type `cp_note` with a private label taxonomy and meta; revisions for earlier versions. Alternative: custom tables.
- **D10** — Manual updates (upload zip → "Replace current with uploaded"); `Update URI: false` blocks wordpress.org updates.
- **D11** — (0.1.1, from ChatGPT review) Logged-in users without `cp_use_hub` get 403 everywhere: front-end, REST, every wp-admin screen, admin-ajax and admin-post, with a "Log out" link. Login, logout and password recovery stay open.
- **D12** — (0.1.1) The status page separates "Protection enabled" (settings) from the "Live check" (verified by requesting the site as a logged-out visitor). Cloudways/cache status counts as unverified until the live check passes on the real server.
- **D13** — (0.1.2, from ChatGPT review) The Live check must test like a real visitor: no cache-bypass headers, each page asked twice, compared with a fresh request. A pass is reported as a spot check, never as proof that no cache exists.
- **D14** — (0.2.0) Folders like Windows Explorer instead of tags/labels: each note is in exactly one folder; folders can be nested. Keep-style labels can be added later on top if needed.
- **D15** — (0.2.0) The 4 websites are top-level folders flagged "website folder" (term meta `cp_is_site`); a note's website = the nearest website folder above it. Any folder can be flagged or unflagged.
- **D16** — (0.2.0, resolves D9) Notes are a private post type `cp_note` (title, text in post_content, checklist JSON in post_excerpt so history keeps it); folders are the private taxonomy `cp_folder`. Not custom tables.
- **D17** — (0.2.0) History = EARLIER text: before a text change, the current text is copied into history if the last copy is 10+ minutes old; WordPress's own "copy after every save" is switched off for app saves. Up to 50 versions.
- **D18** — (0.2.0) Text versions: `cp_version` counts title/text/checklist changes only. A save based on an older version never overwrites: it becomes a "(conflict copy)" note. Pin/status/folder changes always apply.
- **D19** — (0.2.0, changed in 0.3.1 → D26) Unsaved changes are kept in localStorage (synchronous, so nothing is lost when the phone closes the tab), not IndexedDB. Images are not queued offline (adding an image needs a connection).
- **D20** — (0.2.0) Note text is stored exactly as typed (HTML filter paused during app saves) and always displayed as text (textContent / esc_*), never as HTML.
- **D21** — (0.2.0) Uninstall keeps notes, folders and images (deleting the plugin by mistake must not delete notes).
- **D22** — (0.2.0) Google Keep import and Markdown export are postponed (user adds notes by hand for now).
- **D23** — (0.3.0, user request) "Private site" switch: ON by default (missing option = ON). OFF = normal website, only the notes (app page, manifest, images, notes API) stay private. `CONTENT_PIPELINE_PRIVATE` in wp-config.php overrides the switch.
- **D24** — (0.3.0) Notes use their own capability type (`cp_note`/`cp_notes`, granted to administrators at runtime) and folders require `cp_use_hub`, so being able to edit posts never means being able to read notes.
- **D25** — (0.3.1, ChatGPT review) Version check + save (and history restore) run under a per-note lock: an `INSERT IGNORE` row `cp_note_lock_<id>` in the options table (atomic on MySQL/MariaDB and SQLite), value "<expiry>-<token>", 30 s expiry, 10 s wait, then 503 (app retries).
- **D26** — (0.3.1, ChatGPT review; replaces the single key of D19) Safety copies: one localStorage record per tab and note (`<key>:rec:<tab>:<note>`) holding the whole note + unsaved fields; tabs only write/delete their own records; `<key>:alive:<tab>` heartbeat every 5 s, "0" on pagehide; records of tabs silent for 15 s (or marked "0") are taken over. ChatGPT suggested IndexedDB; localStorage was kept because its writes are synchronous (a copy exists even if the tab is killed right after typing), and per-tab records remove the overwrite problem. Open to review.
- **D27** — (0.3.1, ChatGPT review) A change the server refuses is never dropped: it stays queued with an error, the indicator never says "saved" while anything is waiting, and the user gets "Try again" / "Save as new note". Rescue (note deleted/trashed elsewhere) queues the new note before removing the old change.
- **D28** — (0.3.1, ChatGPT review; replaces the 0.2.0 fallback) Images are accepted only when the storage folder is outside the public web folder; otherwise images are switched off (no fallback inside uploads).
- **D29** — (0.3.2, ChatGPT review) A safety copy is only removed after its replacement is confirmed written (`persist()` returns success); copies taken over from other tabs wait in a "taken" list until then. Storage failures are shown as "Not saved" with a lasting message.
- **D30** — (0.3.2, ChatGPT review) Images left by 0.2.0–0.3.0 in uploads/content-pipeline-private are still served (read-only, login required) and can be moved to the private folder with one button on the status page.
