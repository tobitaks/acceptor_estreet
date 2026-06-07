# eStreet New Order Alarm & Auto-Acceptor

Chrome extension (Manifest V3) that monitors the eStreet AMC appraiser dashboard for new broadcast BPO orders, sounds an audio alarm the moment one appears, and auto-accepts it in under a second — typically before a human competitor has even opened the page.

> eStreet broadcasts orders to multiple appraisers at once; **the first to accept wins**. This extension wins that race.

## How it works

```
┌─────────┐   START    ┌────────────┐   opens    ┌───────────────┐
│  Popup   │ ─────────▶ │ Background │ ─────────▶ │ Dashboard tab │
└─────────┘            │  (worker)  │            │  content.js   │
                       └────────────┘            └───────┬───────┘
                              ▲                          │ polls every 200–300ms
                              │                          ▼
                              │                ┌──────────────────┐
                              │   order IDs    │ count > 0 ?      │
                              └─────────────── │ extract ApprIDs  │
                                               └──────────────────┘
        then, in parallel per order:
        🔊 alarm (offscreen audio)  +  ⚡ accept POST  →  📝 log result
```

1. **Detect** — the content script polls the dashboard every 200–300 ms (jittered) and reads the new-order count.
2. **Alarm** — on a new arrival, an offscreen document plays a triple beep (bypasses page autoplay restrictions). You hear it even if Chrome is in the background.
3. **Accept** — order IDs are extracted directly from the server response (no DOM-render wait) and handed to the background worker, which fires the accept request immediately. Multiple orders are accepted in parallel (batches of 10).
4. **Log** — every detection and accept attempt is stored locally and shown in the options page.

**Detection → accept request sent: ~400–700 ms.**

## Features

- 🔊 **Audio alarm** on every new order — works unattended, browser minimized
- ⚡ **Sub-second auto-accept** — headless POST, no page navigation, no clicking
- 🎯 **Order-type filter** — accept Exterior only, Interior only, or everything
- 🧾 **Full audit log** — every detection and accept attempt with outcome:
  - ✅ **Accepted** — order is yours
  - 🟠 **Already Taken** — lost the race (someone accepted first)
  - 🔴 **Failed** — genuine anomaly, with expandable diagnostics (request/response capture)
- 📊 **Stats dashboard** — total attempts / accepted / taken / failed at a glance
- 🚨 **Logged-out alarm** — if the session expires, the alarm sounds and the popup shows a red warning instead of silently monitoring nothing
- 🛡️ **Resilience built in**
  - monitored tab is protected from Chrome memory-saver discard
  - transient network errors are swallowed and retried next tick
  - duplicate accepts are impossible (per-order dedup)
  - re-arms on every count change — new orders are caught even while an unwanted (filtered-out) order keeps the count above zero

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Log into eStreet in the same Chrome profile

## Usage

1. Click the extension icon → **START**
   - opens the dashboard in a new tab and begins monitoring
2. Leave the tab open. Popup shows live count + last-checked time.
3. When an order drops: beep-beep-beep → already accepted by the time you hear it.
4. **STOP** closes the monitored tab and halts monitoring.

### Settings (options page)

| Setting | What it does |
|---|---|
| Auto-accept order types | `Both` / `Exterior only` / `Interior only` — matched against the order's Item(s) text |
| Accepted Orders log | Outcome, redirect URL, timestamp, expandable diagnostics per attempt |
| Detections log | Every alarm: count seen, ApprIDs found, what passed the filter |

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, host permissions |
| `content.js` | Dashboard polling, count detection, order-ID extraction |
| `background.js` | Service worker — accept flow, audio routing, storage, message bus |
| `offscreen.html/js` | Audio playback (offscreen doc, AudioContext beeps) |
| `popup.html/js` | Start/Stop UI, live status |
| `options.html/js` | Logs, stats, order-type filter |

## Performance notes

- Poll interval: 200–300 ms jittered
- Detection and ID extraction reuse a single dashboard fetch — no extra round trips, no live-DOM rendering
- Accepts run parallel-batched (10 at a time)
- One extension instance per Chrome profile; multiple profiles/accounts can run simultaneously (note: they will race each other)

## Disclaimer

For use on accounts you own. Auto-accepting may violate the portal's terms of service — use at your own risk.
