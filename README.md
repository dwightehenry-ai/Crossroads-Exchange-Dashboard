# The Exchange Dashboard

This folder is the production dashboard for **The Exchange** student ministry at Crossroads. It is intentionally separate from the Green Room dashboard.

## Port

- Exchange Dashboard: **3001**
- Green Room Dashboard: **3000**

The Exchange server defaults to port 3001 even if the port is omitted from configuration.

## Planning Center

The Exchange service type is configured as **145138**. Keep `config.json` private because it contains the live Planning Center credentials. `config.example.json` contains safe placeholders.

## Dashboard URLs

On the Exchange Mac itself:

- All screens: `http://localhost:3001/all`
- TV 1: `http://localhost:3001/tv1`
- TV 2: `http://localhost:3001/tv2`
- TV 3: `http://localhost:3001/tv3`
- Control page: `http://localhost:3001/setup.html`
- Diagnostics: `http://localhost:3001/?screen=all&debug=1`

From another device on the same network, replace `localhost` with the Exchange Mac's IPv4 address. Example: `http://10.0.2.50:3001/tv1`.

## Screen rules

### TV 1
- Communication Team
- Service Support
- Firefighter and PA Team Lead appear in Service Support
- Planning Center photos are used when available

### TV 2
- Worship Service Lead appears above Vocals
- Vocals are a separate group
- Music Director / MD appears with Band
- Worship Leader / Worship Pastor is excluded from the normal vocal/band cards
- Tonight's Songs shows up to the first three detected Planning Center song items

### TV 3
- Order of Service begins at **Open Doors**
- Anything before Open Doors is hidden
- Service times are not displayed

## Branding

`public/exchange-logo.png` is the approved Exchange logo: black circle with the white stylized E. The dashboard header, favicon, and Apple touch icon use that same file.

## Responsive behavior

The dashboard is designed for TVs, tablets, laptops, and phones. Single-screen pages use responsive CSS plus automatic fit scaling. The fit process recalculates after data refreshes, window/orientation changes, visual viewport changes, and image loads.

For troubleshooting, automatic fit can be disabled by adding `?fit=off` to a single-screen query URL, for example `http://localhost:3001/?screen=2&fit=off`.

## Start / stop on macOS

From Terminal in this folder:

```bash
./start-exchange.sh
./stop-exchange.sh
./restart-exchange.sh
```

Or start directly with:

```bash
npm start
```

If dependencies are missing, run `npm install` once.

## Version 4.3.0 layout update

- TV 1 uses compact Communication role tiles and reserves more room for Service Support.
- TV 1 Announcements and Verse of the Day are manual, plan-specific fields managed at `/setup.html`.
- Presenter and Sermon Communicator are treated as the Speaker position.
- The duplicate Additional Communication section was removed.
- TV 2 vocalist cards now use the same horizontal card treatment as the Worship Service Lead.
- Songs show the key beside the song and singers in the song description line.
- TV 3 continues to start at Open Doors, groups announcements, shows game details/singers, and stops after Closing Thoughts.

## Version 4.3.0 display and manual-input update

- ALL view uses compact Communication and Worship preview cards so names remain horizontal and readable when all three TVs are shown together.
- TV 2 and TV 3 read singer names from each song's Planning Center Description field.
- TV 2 includes a Worship Notes section below Tonight's Songs.
- Manual TV content is entered at `http://localhost:3001/setup.html`: TV 1 Announcements, TV 1 Verse of the Day, and TV 2 Worship Notes.
- The dashboard navigation includes a SETUP link for quick access on the control computer.
