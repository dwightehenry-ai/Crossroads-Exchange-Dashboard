# The Exchange Dashboard v4.8

Version 4.8 is based directly on the supplied v4.7 dashboard.

## v4.8 changes

- Exchange Dashboard remains on port **3001**.
- Exchange Dashboard Control remains on port **3002** and can stay running while the dashboard is stopped.
- Controller starts the dashboard with `npm start` (`node server.js`) from the installed Exchange folder.
- Controller PIN is **1386** by default.
- Fixed **Input Manager** in Dashboard Control to open `/exchange-input.html`.
- Added **CONTROL** to the main ALL-dashboard navigation. It opens port 3002 using the same iMac hostname/IP used to open the dashboard.
- Added **Dashboard Control** to the Input Manager navigation.
- Controller status verifies whether port 3001 is actually running.
- Start, stop, and restart provide a result instead of silently failing.
- Controller can be installed as a macOS LaunchAgent so it is available even when the dashboard itself is stopped.

## Install / replace the dashboard

Use the `crossroads-exchange-dashboard` folder from this package as the installed Exchange folder. Then, from Terminal inside that folder:

```bash
./install-exchange-controller-autostart.sh
```

The phone controller is then:

```text
http://<iMac-IP>:3002
```

The dashboard is:

```text
http://<iMac-IP>:3001
```

## Verify

From the project folder:

```bash
./verify-v4.8.sh
```

The verification uses temporary ports 3211/3212 so it does not interfere with the normal 3001/3002 installation.
