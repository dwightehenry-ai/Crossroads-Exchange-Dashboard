# The Exchange Dashboard v4.9

Version 4.9 is based directly on v4.8.

## v4.9 changes

- Exchange Dashboard remains on port **3001**.
- Exchange Dashboard Control remains on port **3002**.
- The phone controller now has a dedicated **Dashboard Manager** button.
- If the dashboard is stopped, tapping **Dashboard Manager** starts the dashboard first and then opens the manager automatically.
- The manager remains available directly at `http://<iMac-IP>:3001/exchange-input.html` while the dashboard is running.
- The manager is now installable on iPhone as its own Home Screen web app.
- The ALL dashboard navigation now labels the manager link **MANAGER** and still includes **CONTROL**.
- Dashboard Manager keeps direct links to the dashboard, technical setup, and Dashboard Control.
- Phone controls were enlarged and simplified for narrow iPhone screens.

## Phone flow

Open the controller:

```text
http://<iMac-IP>:3002
```

Enter PIN `1386`, then tap **Dashboard Manager**. If port 3001 is stopped, the controller starts it automatically before opening the manager.

To install the manager separately on iPhone, open the manager in Safari, use Share, then **Add to Home Screen**.

## Verify

From the project folder:

```bash
./verify-v4.9.sh
```
