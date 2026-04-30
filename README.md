# HIL System Simulator

A Hardware-in-the-Loop demo that decouples firmware from UI using **ProtoPie Connect** as a middleware bridge. An Arduino Uno + Grove Beginner Kit acts as the real microcontroller, a React app in the browser is the bridge gateway, and a ProtoPie prototype loaded inside the same page is the product UI — all wired together over Socket.IO.

---

## Why this exists

### The pain point — *"The Puppet Show"*

In a typical embedded workflow, the developer is forced to be both the puppeteer (hardware) and the puppet (UI). UI logic and hardware drivers live on the same chip, so changing a single pixel means recompiling the entire firmware (30 seconds to 5 minutes per cycle, plus flash wear).

To avoid waiting on physical events — a sensor reaching 100 °C, a battery draining to 5 % — developers bake **"throwaway" backdoor code** straight into production firmware:

> *"If I type `E` over UART, pretend the motor exploded."*

That's hard-coded triggers, fake hardware paths, and recompiles for every UI tweak. ~70 % of the engineer's time disappears into disposable bridge code; ~30 % goes to actual product features.

### The shift — Hardware-in-the-Loop with ProtoPie Connect

Move the UI logic **off** the chip and **onto** a PC. The firmware reports real sensor readings. A middleware bridge (this React app) translates those readings into UI events. ProtoPie renders the UI and replies with user actions. Both sides stay clean, and edge cases are reproduced by **injecting** signals at the bridge instead of forcing them on the hardware.

| Old way (monolithic) | New way (HIL) |
|---|---|
| UI and hardware in one C++ file | Hardware on chip, UI on PC |
| Hard-coded UART backdoors for demos | Real triggers from real sensors |
| Recompile for every pixel change | Live UI updates over Socket.IO |
| `if (key == 'E') fake_explosion()` | `bridge.send({ critical: true })` |

**The value:** firmware stays production-ready, UI iterates instantly, edge cases are reproducible without lab gear.

---

## Architecture

```
┌────────────────┐   USB Serial   ┌──────────────────┐   Socket.IO    ┌──────────────────┐
│  Arduino Uno   │ ─────────────▶ │  Bridge Gateway  │ ─────────────▶ │ ProtoPie Connect │
│  (Grove Kit)   │ ◀───────────── │   (this React    │ ◀───────────── │   localhost:9981 │
│                │                │       app)       │                │        │         │
│ • rotary pot   │                │ • Web Serial API │                │        ▼         │
│ • LED on D4    │                │ • protocol parse │                │   Pie (iframe)   │
│ • OLED (I2C)   │                │ • Socket.IO hub  │                │                  │
└────────────────┘                └──────────────────┘                └──────────────────┘
```

Three concerns, three boxes, each independently swappable:

1. **STM32 firmware tier** — `arduino/hil_grove/hil_grove.ino`. Reads the pot, drives the LED, refreshes the OLED, speaks a tiny ASCII UART protocol.
2. **Bridge tier** — `hil-simulator/` (React + Vite + Tailwind). Hosts the live conversation: a three-panel UI showing the firmware state, the bridge log, and the embedded Pie. Forwards messages bidirectionally between USB serial and ProtoPie Connect's `ppMessage` channel.
3. **Product UI tier** — a Pie running in ProtoPie Connect, embedded as an iframe inside the bridge page. Receives sensor data, sends user actions back.

---

## Wire protocol

The bridge is purely a translator — it never synthesizes values on its own. Every signal the Pie sees originates on the Arduino, even when the user injected it from the bridge terminal. Test mode is a state living **on the Arduino**; the bridge just flips it.

### Data flows

**Temperature — Test Mode OFF (live potentiometer)**

```
Arduino ──RPT:TEMP:<n>──▶ Bridge ──ppMessage{temperature, "<n>"}──▶ Pie
```

The pot is the source. Arduino reports periodically; the bridge mirrors each report onto the Socket.IO channel.

**Temperature — Test Mode ON (manual injection)**

```
Bridge ──SET:VAL:<n>──▶ Arduino ──RPT:TEMP:<n>──▶ Bridge ──ppMessage{temperature, "<n>"}──▶ Pie
```

The user types a value into the bridge terminal. The bridge writes it to the Arduino, the Arduino acknowledges by *reporting it back* as the new temperature, and only then does it propagate to the Pie. Round-tripping through the Arduino keeps the Pie's view of state consistent with the firmware's view. (In this demo the Pie itself never injects temperatures — it only reads them.)

**Light — initiated from the bridge terminal**

```
Bridge ──CMD:LIGHT:ON|OFF──▶ Arduino ──ACK:LIGHT:ON|OFF──▶ Bridge ──ppMessage{led, "ON|OFF"}──▶ Pie
```

**Light — initiated from a ProtoPie button**

```
Pie ──ppMessage{led, "on|off"}──▶ Bridge ──CMD:LIGHT:ON|OFF──▶ Arduino ──ACK:LIGHT:ON|OFF──▶ Bridge
```

The bridge re-emits the resulting `led` state back to the Pie *only* if the command came from the bridge terminal — the suppression flag stops it from echoing the Pie's own action back to it.

### messageId reference (Socket.IO `ppMessage` on `http://localhost:9981`)

| Direction | `messageId` | `value` |
|---|---|---|
| Bridge → Pie | `temperature` | numeric string, e.g. `"75.4"` |
| Bridge → Pie | `led` | `"ON"` / `"OFF"` |
| Bridge → Pie | `bridge` | raw protocol line, for debugging |
| Pie → Bridge | `led` | `"on"` / `"off"` / `"toggle"` |

The bridge also accepts `toggleLight` and a generic `cmd` (raw passthrough) inbound for flexibility, but this demo's Pie only emits `led`. Temperature is one-way Bridge → Pie — the Pie never sends temperature back.

### USB Serial reference (115200 baud, newline-terminated)

| Direction | Message | Meaning |
|---|---|---|
| Arduino → Bridge | `RPT:TEMP:<float>` | Periodic temperature report |
| Arduino → Bridge | `ACK:LIGHT:ON\|OFF` | Confirmation after a light command |
| Bridge → Arduino | `SET:TEST:ON\|OFF` | Switch between potentiometer and fixed test value |
| Bridge → Arduino | `SET:VAL:<float>` | Set the fixed test value (also enables test mode) |
| Bridge → Arduino | `CMD:LIGHT:ON\|OFF\|TOGGLE` | Control the LED |

---

## Quick start

### Prerequisites

- **Node.js ≥ 20.19** (use `nvm` if you need to upgrade)
- **Chrome, Edge, or Opera** — Web Serial isn't supported in Safari or Firefox
- **Arduino IDE** with the **Arduino Uno** core installed
- **ProtoPie Connect** running on `http://localhost:9981` (default port)
- **Arduino Uno + Grove Beginner Kit**

### 1. Clone and run the bridge

```bash
git clone https://github.com/JubzMajulee/STM32-simulator.git
cd STM32-simulator/hil-simulator
npm install
npm run dev
```

Open `http://localhost:5173` in **Chrome / Edge** as a top-level tab. Web Serial is blocked in iframes; if you launch it from inside another app you'll get a `permissions policy` error.

### 2. Flash the Arduino

1. In Arduino IDE → **Sketch → Include Library → Manage Libraries…** → install **U8g2 by olikraus**.
2. Open `arduino/hil_grove/hil_grove.ino`.
3. **Tools → Board: Arduino Uno**, **Tools → Port:** the Grove kit's USB port.
4. Click Upload, watch for `Done uploading`.

The OLED should show `HIL SENSOR · LIVE`, big temperature digits, and `LED: OFF`.

### 3. Connect the simulator to the board

1. Close the Arduino IDE Serial Monitor — only one process can hold the USB port.
2. In the running React app, click **Connect** in the **STM32 Microcontroller** panel.
3. Pick the Uno's port from Chrome's device picker.
4. Status pill turns green: `Arduino · Live (USB)`. The temperature digits in the panel start tracking the rotary potentiometer.

### 4. Embed the Pie

1. Start ProtoPie Connect.
2. **In Connect's preferences, set the network address to the local loopback (`127.0.0.1` / `localhost`) — not the LAN IP (`192.168.x.x`).** The bridge looks for Connect at `http://localhost:9981`; if Connect is bound to a LAN interface instead, the Socket.IO handshake never reaches it and the footer pill stays red.
3. Open your `.pie` file in Connect.
4. Copy the Connect's web embed URL (or any cloud-hosted Pie URL).
5. In the **Product UI (ProtoPie)** panel, paste the URL and click **Load Pie**.
6. The footer pill goes green: `Connected to ProtoPie`.

The Pie can now receive `temperature` / `led` updates and send `setTemp` / `led` / `toggleLight` / `cmd` events back. The bridge log in the middle panel shows every message in both directions.

> **Need a different host?** Override the default in `hil-simulator/.env.local`:
> ```
> VITE_PROTOPIE_URL=http://127.0.0.1:9981
> ```
> Restart `npm run dev` after creating the file.

### 5. Trigger edge cases without touching hardware

You don't need to physically heat the sensor to test the "Critical" UI state.

- Type `120` into the bridge terminal → `SET:VAL:120` → Arduino enters test mode and reports `120 °C` → ProtoPie reacts.
- Type `light:on` → `CMD:LIGHT:ON` → real LED on the Grove kit lights up, and ProtoPie's `led` listener fires.
- Or send the same commands directly from the Pie via `Send` triggers — the bridge forwards them over USB.

---

## Repository layout

```
STM32_simulator/
├── arduino/
│   ├── hil_grove/        production sketch (pot + LED + OLED + serial protocol)
│   ├── i2c_scanner/      diagnostic — lists I2C devices on the Grove bus
│   └── oled_test/        diagnostic — tests OLED init at 100 kHz
├── hil-simulator/        React + Vite bridge app
│   └── src/App.jsx       three-panel UI, Web Serial + Socket.IO
├── setup.md              terse step-by-step setup checklist
└── README.md             this file
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connect button → `permissions policy` error | Page is loaded in an iframe (e.g. inside ProtoPie Connect). | Open `http://localhost:5173` as a top-level tab in Chrome. |
| Connect button missing | Browser doesn't support Web Serial. | Use Chrome, Edge, or Opera. Safari and Firefox are not supported. |
| Arduino upload fails: `U8g2lib.h: No such file` | U8g2 library not installed. | Library Manager → install **U8g2 by olikraus**. |
| Serial Monitor shows `?` characters | Baud rate mismatch. | Set Serial Monitor to **115200** in the bottom-right dropdown. |
| Serial Monitor silent after upload | OLED hangs U8g2 begin() at 400 kHz. | The current sketch already forces 100 kHz; if it returns, run `arduino/i2c_scanner` to verify the OLED is at `0x3C`. |
| `Low memory available` warning at upload | U8g2 full-buffer mode + `String` heap fragmentation. | Already addressed: the sketch uses page-buffer mode (`_1_HW_I2C`) and a `char[]` input buffer with `F()` flash strings. |
| ProtoPie button floods the bridge log | ProtoPie's `Send` trigger is firing continuously (e.g. While-Touch). | Idempotency guard in the bridge already drops redundant `led:on/off` messages — if you see flooding, check the trigger type in Studio. |
| Footer pill stuck on red `ProtoPie not reachable` | ProtoPie Connect's network setting is bound to the LAN IP (`192.168.x.x`) instead of localhost. | In Connect's preferences, switch the network address to `127.0.0.1` / `localhost`. The bridge connects to `http://localhost:9981` by default. |

---

## Credits

Built as a demo for showing engineers how ProtoPie Connect removes the need for "throwaway bridge code" inside production firmware. The UI iterates over Socket.IO; the C++ stays clean.
