# SchoolSyncer coming-soon page

A single self-contained `index.html` (inline CSS and JS, no build step). Upload it as the site root (`public_html/index.html`) on any host.

Before uploading, edit the `CONFIG` block near the bottom of `index.html`:

- `email`: where the "Notify me" form sends mail (it opens the visitor's email app; there is no backend).
- `whatsapp`: number with country code, no `+` or spaces, e.g. `923001234567`. Leave empty to hide the WhatsApp button.

To preview locally: open `index.html` in a browser.
