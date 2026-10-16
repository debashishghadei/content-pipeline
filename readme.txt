=== Content Pipeline Hub ===
Contributors: debashishghadei
Tags: private, notes, content, workflow
Requires at least: 6.8
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Private content hub: capture ideas and turn them into articles for your sites.

== Description ==

Install on a separate, private WordPress site (the "hub").

* The whole site is private: logged-out visitors only see the login screen.
* REST API, feeds, sitemaps, author pages, comments, XML-RPC and sign-ups are blocked.
* Search engines are told not to index anything.
* After login you land on the notes app (/notes/): notes with checklists, Explorer-style folders, search, pin, status, trash, history, protected images.
* Saving survives bad connections: changes are kept on the device until the server has them.
* Works on phones and can be added to the Android home screen.
* Ollama test page to check a local AI model on your PC.

== Changelog ==

= 0.2.0 =
* Notes app with folders, search, autosave/offline saving, conflict copies, history, trash, protected images, phone layout, Ollama test page.

= 0.1.2 =
* Live check asks like a normal visitor (no cache-bypass headers), twice, and compares with a fresh request, so a cache serving private pages is caught.

= 0.1.1 =
* Users without hub permission are blocked from wp-admin and admin-ajax too.
* Status page: live check of what a logged-out visitor really gets.

= 0.1.0 =
* Lockdown, notes app shell, status page.
