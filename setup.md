# HIL System Simulator — Setup Checklist

Step-by-step setup. For the *why* and the architecture, see [`README.md`](./README.md).

## 1. Prerequisites

- **Node.js ≥ 20.19** (use `nvm install --lts && nvm use --lts`)
- **Chrome / Edge / Opera** — Web Serial is required and not in Safari or Firefox
- **Arduino IDE** with the Arduino Uno core
- **U8g2 by olikraus** library (Library Manager)
- **ProtoPie Connect** running on `http://localhost:9981`
- **Arduino Uno + Grove Beginner Kit**

## 2. Bridge app (React + Vite)

```bash
git clone https://github.com/JubzMajulee/STM32-simulator.git
cd STM32-simulator/hil-simulator
npm install
npm run dev
```

Open `http://localhost:5173` in a **top-level Chrome / Edge tab** (not inside ProtoPie Connect's webview — that blocks Web Serial via Permissions-Policy).

## 3. Arduino firmware

1. Arduino IDE → **Sketch → Include Library → Manage Libraries…** → install **U8g2 by olikraus**.
2. Open `arduino/hil_grove/hil_grove.ino`.
3. **Tools → Board: Arduino Uno**, **Tools → Port:** Grove kit's USB port.
4. Click **Upload**. Wait for `Done uploading`.
5. Verify with Serial Monitor at **115200 baud**: `RPT:TEMP:<n>` lines should stream once a second and faster as you turn the pot.
6. Close the Serial Monitor before continuing — only one process can hold the USB port.

## 4. Hook the bridge to the Arduino

1. In the running React app, click **Connect** in the **STM32 Microcontroller** panel.
2. Pick the Uno's port from Chrome's picker.
3. Pill should turn green: `Arduino · Live (USB)`. The temperature digits start tracking the rotary potentiometer.

## 5. Embed the Pie

1. Start ProtoPie Connect.
2. **In Connect's preferences, set the network address to `127.0.0.1` / `localhost` — not the LAN IP** (`192.168.x.x`). The bridge talks to `http://localhost:9981`; if Connect is bound to a LAN interface, the Socket.IO connection never lands.
3. Open your `.pie` file in Connect.
4. Copy the Pie's embed URL (Connect's web preview link, or a cloud share link).
5. In the **Product UI (ProtoPie)** panel, paste the URL → **Load Pie**.
6. The footer pill should turn green: `Connected to ProtoPie`. The Pie now receives `temperature` / `led` updates and can send `setTemp` / `led` / `toggleLight` / `cmd` events back.

> Override the bridge URL by creating `hil-simulator/.env.local` with `VITE_PROTOPIE_URL=http://127.0.0.1:9981`, then restart `npm run dev`.

## 6. Sanity test

- Turn the rotary pot → temp updates on the Arduino's OLED, in the bridge panel, and inside the Pie.
- Type `120` in the bridge terminal input → Arduino enters test mode, reports `120 °C`, the Pie's UI reacts.
- Type `light:on` in the bridge terminal → physical LED on the Grove kit turns on; bridge log shows `CMD:LIGHT:ON` → `ACK:LIGHT:ON`.
- Press a `Send → led:on` button in the Pie → same path, just initiated from ProtoPie.

## Diagnostic sketches (optional)

If the Arduino misbehaves, upload one of these temporarily and check Serial Monitor at 115200:

- `arduino/i2c_scanner/i2c_scanner.ino` — lists every I2C device on the Grove bus. Expect to see `0x19` (accelerometer), `0x3C` (OLED), `0x77` (pressure sensor).
- `arduino/oled_test/oled_test.ino` — minimal OLED init at 100 kHz; confirms the U8g2 driver profile works on your unit.

After diagnostics, re-upload `hil_grove.ino` to restore normal operation.

## Common errors

| Error | Where | Fix |
|---|---|---|
| `Failed to execute 'requestPort' on 'Serial': Access to the feature "serial" is disallowed by permissions policy` | Browser console on Connect click | Page is in an iframe. Open `http://localhost:5173` directly in a top-level Chrome tab. |
| `U8g2lib.h: No such file or directory` | Arduino IDE compile | Install U8g2 via Library Manager. |
| Serial Monitor shows `?` characters | Arduino IDE | Set baud rate dropdown to **115200**. |
| `Low memory available, stability problems may occur` | Arduino IDE upload | Already mitigated in the current sketch (page-buffer mode + `F()` macros). If it returns, you have an old sketch — re-pull and re-upload. |
| Footer pill stuck on `ProtoPie not reachable` | Browser, after Load Pie | Switch ProtoPie Connect's network setting to `127.0.0.1` / `localhost`. The default LAN binding (`192.168.x.x`) is unreachable from `http://localhost:9981`. |
