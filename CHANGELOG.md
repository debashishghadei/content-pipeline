# Changelog

All notable changes to Content Pipeline Hub. Versions follow semantic versioning (0.x while Phase 1 is built).

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
