# Content Pipeline Hub

Private content hub for my WordPress sites: capture ideas, turn them into articles, send them as drafts.

WordPress plugin, installed on a separate private WordPress site (the hub). PHP 8.4.

- Plan and status: `HANDOFF.md` (start here), `DECISIONS.md`, `CHANGELOG.md`
- Build the zip: `bin/build.sh` → `dist/content-pipeline-X.Y.Z.zip`
- Tests: `tests/` (not included in the zip). Each release ships a `TEST-REPORT` run against the extracted zip.

Updates are manual: Plugins → Add New → Upload → "Replace current with uploaded". Settings are kept.
