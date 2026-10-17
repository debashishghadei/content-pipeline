=== Content Pipeline Hub ===
Contributors: debashishghadei
Tags: private, notes, content, workflow
Requires at least: 6.8
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.4.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Private content hub: capture ideas and turn them into articles for your sites.

== Description ==

Install on a separate, private WordPress site (the "hub").

* "Private site" ON (default): the whole site is private; logged-out visitors only see the login screen. OFF: the website works normally and only your notes are private.
* REST API, feeds, sitemaps, author pages, comments, XML-RPC and sign-ups are blocked.
* Search engines are told not to index anything.
* After login you land on the notes app (/notes/): notes with checklists, Explorer-style folders, search, pin, status, trash, history, protected images.
* Saving survives bad connections: changes are kept on the device until the server has them.
* Works on phones and can be added to the Android home screen.
* Ollama test page to check a local AI model on your PC.
* Article workspace: note → cleanup → outline → draft → polish → check → SEO → copy to WordPress, with writing settings per website.

== Changelog ==

= 0.4.1 =
* Article saving: a write WordPress refuses is reported and retried (never shown as saved); typing during a conflicting save is kept. Warning when the draft changed after polishing, with a choice of which text to export.

= 0.4.0 =
* Article workspace: turn a note into an article in 7 steps with Copy prompt / Paste answer (ChatGPT or Claude), automatic checks, SEO fields, and Copy for WordPress (blocks incl. Blog Kit boxes). Writing settings per website with example articles, style guide and editable prompts.

= 0.3.3 =
* Safety copies are never removed before their replacement is stored, for every kind of change.

= 0.3.2 =
* Safety copies are only replaced after the new copy is stored; old public images can be moved to the private folder.

= 0.3.1 =
* Fixes from review: simultaneous saves locked per note, unsent edits survive notes deleted elsewhere and multiple tabs, refused saves are kept with Try again, images only stored outside the website.

= 0.3.0 =
* "Private site" switch: turn the whole-site lock off to try the plugin on a normal site; notes stay private either way.

= 0.2.0 =
* Notes app with folders, search, autosave/offline saving, conflict copies, history, trash, protected images, phone layout, Ollama test page.

= 0.1.2 =
* Live check asks like a normal visitor (no cache-bypass headers), twice, and compares with a fresh request, so a cache serving private pages is caught.

= 0.1.1 =
* Users without hub permission are blocked from wp-admin and admin-ajax too.
* Status page: live check of what a logged-out visitor really gets.

= 0.1.0 =
* Lockdown, notes app shell, status page.
