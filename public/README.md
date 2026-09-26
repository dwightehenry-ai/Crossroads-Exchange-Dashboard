# Green Room mobile dashboard

A responsive, phone friendly companion to the existing Crossroads Green Room Dashboard. The original wallboard stays in place. This addition uses its existing `/api/dashboard` data endpoint; no new credentials or server dependencies are needed.

## Add it to the dashboard

1. Extract this package.
2. Copy the entire `public/mobile` folder into the **current** dashboard's `public` folder. Keep the `mobile` folder name. There is no need to replace `server.js`, `app.js`, `styles.css`, or `config.json`.
3. Open `http://DASHBOARD-COMPUTER-IP:3000/mobile/` on a phone connected to the dashboard's network. If the dashboard is hosted at an HTTPS URL, open `https://YOUR-DASHBOARD-HOST/mobile/`. Use the port your dashboard actually runs on.
4. On iPhone, open in Safari, tap **Share** → **Add to Home Screen**. On Android, open in Chrome, tap the menu → **Add to Home screen** or **Install app** when available.

## Screens

- **Team**: confirmed vocals, band, and communicators only. Tap a person to reveal their larger photo, full name, position, pack, and mic. Missing assignments say “Not assigned.” Choir positions are included only if the dashboard's existing `/api/dashboard` `volunteers.vocals` list includes them.
- **Service**: current item, next item, and the green room message.
- **Systems**: the dashboard's current device and connection status.

The app refreshes from the dashboard on the server's configured interval. It shows **Disconnected** if updates fail and keeps the last received information visible while retrying. Photos require the image URLs used by the dashboard to be reachable from the phone. Offline access is intentionally unavailable because assignments change during a service.

## Compatibility

This is a browser based home screen app for Android and iPhone. It works at phone and tablet widths. Chrome's full install prompt and standalone PWA behavior can require HTTPS; on a local HTTP network, use **Add to Home Screen** when the browser offers it. The phone must be able to reach the existing dashboard server. No app store submission is included.
