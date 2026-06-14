# Stellavault Web Clipper (T3-4)

A minimal Manifest V3 browser extension that clips the current page — or just your
text selection — straight into your local Stellavault vault. Nothing leaves your
machine: the clip is POSTed to the desktop app's **local** Publish server
(`http://127.0.0.1:<port>`), which writes a markdown note into your vault, then
auto-embeds it and seeds decay so it is searchable immediately.

## How it works

```
browser selection ──► popup.js ──► POST /api/clip ──► Stellavault desktop (127.0.0.1)
                                                       └─► writes Clips/<date> <title>.md
                                                       └─► auto-embed + decay seed
```

The endpoint accepts `{ url, html, selection, title }`. Because the **browser**
supplies the page content (not a URL the server re-fetches), there is no SSRF
surface and you capture exactly what you selected.

## Install (Chrome / Edge / Brave — unpacked)

1. In the Stellavault **desktop app**, start the Publish server:
   **Tools → Publish: start read-only server** (or the command palette →
   "Publish: start local read-only server"). Note the port (default **3105**).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select this `tools/web-clipper/` folder.
5. Pin the extension. Click its icon, confirm the **port** matches the desktop
   app's Publish port, then click **Clip selection / page**.

> Firefox: the same files load via `about:debugging` → "This Firefox" →
> "Load Temporary Add-on" → pick `manifest.json`. (MV3 background differs across
> browsers, but this extension has no background script, so it works as-is.)

## Notes

- An `icon.png` (128×128) is referenced by the manifest. Any PNG works; the
  extension functions without a custom icon (the browser shows a default).
- Clips land in `<vault>/Clips/`. Re-clipping the same page on the same day gets a
  `(2)`, `(3)`… suffix — existing clips are never overwritten.
- The Publish server is **local read-only** for browsing, but the `/api/clip`
  endpoint is a write. It is bound to `127.0.0.1`, so only software on your own
  machine can reach it.
