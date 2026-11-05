# Hashmi School coming-soon page

Single self-contained `index.html` for hashmischool.edu.pk. No build step.

## Deploy on Cloudflare Pages

**Direct Upload (simplest):** Cloudflare dashboard > Workers & Pages > Create > Pages > Upload assets. Name the project, upload this folder (or the zip), deploy. Then open the project > Custom domains > Set up a domain > `hashmischool.edu.pk`.

**From Git:** connect this repository, set the build command to empty, framework "None", and the build output directory to `apps/coming-soon/hashmi-school`.

## Before going live

Edit the `CONFIG` block near the bottom of `index.html`:

- `email`: the school's email. The "Notify me" form opens the visitor's mail app to this address. While empty, the form, the "Get notified" button and the bottom sign-up section are hidden.
- `whatsapp`: number with country code, no `+` or spaces (e.g. `923001234567`). Empty hides the WhatsApp button.
