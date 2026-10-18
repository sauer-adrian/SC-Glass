# SC Glass 2

A touch control deck for Star Citizen, in the spirit of GameGlass. Your tablet, phone or a PC
touchscreen becomes a cockpit panel; a small companion on your gaming PC turns every touch into the
real keypress, mouse click or joystick axis.

**What it does**
- **Knows your ship.** Reads Star Citizen's `Game.log`, so when you board a ship the deck switches to the
  layout for it (Mining, Salvage, Hauler, Fighter, or your own) and resets the switch lights to a cold ship.
- **Uses your keybinds.** Reads your `actionmaps.xml` and follows changes you make in the game, live.
- **Six decks built in:** Standard (6 pages, ~120 controls), Fighter, Mining, Salvage, Hauler and an
  Edge strip for wide touch bars like the Corsair Xeneon Edge.
- **Real controls:** backlit switches with lights, guarded switches, rockers that repeat while held,
  power-distribution sliders, rotary dials and selectors, a throttle lever, a trackpad for the mouse,
  and **sequences** (Combat ready, Travel, Landing prep, Start mining…) that skip steps already done.
- **Layout editor** on the device itself: add, move, resize and retype controls, build sequences,
  pages and panels, undo/redo, manufacturer skins. Save once and every paired device updates.
- **Share codes:** a deck fits in one copyable code.
- **Live info:** current ship and its specs, location, session, contracts, a game event log, and
  where to sell or buy any commodity (UEX community prices).
- **Analog output** through vJoy (optional): sliders and the throttle drive real joystick axes.
- **PC touchscreen overlay** that doesn't steal focus from the game.

## First run

1. On the gaming PC, start **`SCGlass.exe`** (or `start.bat` if you use Python 3.9+).
2. A **setup page** opens in your browser and checks everything by itself:
   - finds Star Citizen (any drive, any build: LIVE, PTU…),
   - reads your keybinds,
   - offers to give the few deck controls that have no key in Star Citizen a spare one (your only click),
   - waits for your tablet, and can run a quick key test.
3. **Scan the QR code** with your tablet or phone camera (same Wi-Fi). It pairs on its own; no typing.
   The QR code is also printed in the SC Glass window and works without internet.
4. If Windows asks whether SC Glass may use the network, choose **Allow** on private networks.
5. The tablet shows a one-minute welcome: pick what you fly, try four switches in a drill
   (nothing reaches the game), and pin the deck to your home screen.

After that there's nothing to set up. Start SC Glass, open the deck, fly. The setup page is always at
`http://localhost:8710/setup` on the PC, and the welcome can be replayed from the deck's Settings.

## Using the deck

| Control | How it works |
|---|---|
| Switch with light | Tap to toggle. The lower half shows the state (ON, DOWN, NAV…). |
| Any light that's wrong | Press and hold a second: the light flips, no key is sent. |
| Guarded switch (Eject, Self destruct…) | First tap lifts the hazard guard, second tap within 4 s fires. |
| Rocker − / + | Tap for one step, hold to repeat. |
| Power slider | Drag to the pips you want; it sends the right number of steps. Hold first to correct the pips without sending. |
| Rotary dial | Turn it: one step per detent. Tap the left or right half for a single step. |
| Rotary selector | Tap a position or turn the knob. |
| Throttle lever | Drag. With vJoy it's a real axis; without, it steps the speed limiter. |
| Trackpad | Drag to move the mouse, tap to click, hold to drag, two fingers for right click. |
| Sequence (SEQ) | Runs several actions in order on your PC, skipping steps whose light says they're done. |

**Deck chip (top left):** pick a deck, duplicate, share, import or delete. While you're in a ship,
the deck you pick is remembered for that ship.
**KEYS:** tap any control to see or change the key it sends.
**EDIT:** change the layout. Built-in decks are never modified; your first edit makes your own copy.

## How keys are chosen

For each action, in order: a key you set on the deck → your binding in Star Citizen → the game default.

### Spare keys for unbound actions

Some useful actions have no default key in Star Citizen (Guns mode, Missile mode, Set NAV/SCM, ESP,
Doors, Door locks, shield faces). With your OK (one click on the setup page, or *Give it a spare key* in
KEYS), SC Glass adds a key for each one to Star Citizen's own keybinds:

- It uses **Right Ctrl + F1–F12** and **Right Ctrl + numpad**, which Star Citizen doesn't use by default.
  Never Alt combinations: Alt+F4 would close the game.
- It only adds keys to actions that have none. Your own binds are never changed.
- It only writes while Star Citizen is closed, because the game rewrites its keybinds when it exits.
  If the game is running, the keys go in right after you quit.
- It backs up `actionmaps.xml` to `backups/` first. **Undo** on the setup page removes only the keys SC Glass added, so binds you changed since stay put.
- If a patch resets your keybinds, it notices and adds the keys again.

Once you've agreed, tapping a control without a key, or saving a deck that uses one, sets the key up automatically.

## Optional: analog controls with vJoy

1. Install vJoy **v2.2.2.0** from https://github.com/BrunnerInnovation/vJoy/releases (works on Windows 10 and 11).
2. Open *Configure vJoy*, enable device 1 with the axes you want (X to Slider 2) and 32 buttons.
3. Restart SC Glass. Settings › Analog controls shows the device.
4. In Star Citizen, bind the action you want (e.g. throttle, mining laser power) by moving the deck's lever
   while the game listens for input. Buttons can also send **JOY1–JOY32** (pick them in KEYS).

## Optional: deck on a PC touchscreen

Settings › *Deck on a PC touchscreen* opens the deck borderless and always on top on a second screen
(a Xeneon Edge, a portable monitor), using Edge or Chrome. The window is set not to take focus, and if
it ever does, SC Glass hands focus back to Star Citizen before sending a key. Pick the **Edge strip** deck
for 2560×720 strips.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tablet can't load the page | Same Wi-Fi? Allow SC Glass through Windows Firewall on private networks. Guest networks often isolate devices. |
| Lamp says GAME NOT IN FRONT | Click into Star Citizen, or turn off *Only press keys while Star Citizen is in front*. |
| Taps do nothing, no warning | Run the key test on the setup page. If it fails and Star Citizen or the RSI Launcher runs as administrator, run SC Glass as administrator too. |
| A spare key doesn't work in game | Star Citizen reads keybinds when it starts. Restart the game once after SC Glass adds keys. |
| Deck doesn't switch with my ship | Settings › Star Citizen files shows whether Game.log was found. Use `--gamelog "D:\...\LIVE\Game.log"` for unusual installs. |
| Keybinds not found | `--actionmaps "D:\...\LIVE\USER\Client\0\Profiles\default\actionmaps.xml"` |
| No prices or ship specs | The PC needs internet for UEX. The last good data is cached in `cache/`. |
| Port 8710 is taken | `start.bat --port 8711` |
| Forgot the PIN | It's in the SC Glass window. `--new-pin` makes a new one. |

## Files

- `sc_glass.py`, `glass/` – the companion (Python standard library only)
- `web/` – the deck, served to your devices by the companion
- `decks/` – your decks (JSON), created when you save one
- `sc_glass_config.json` – PIN, port, your deck-only key changes
- `cache/` – UEX data, overlay browser profile
- `backups/` – copies of your Star Citizen keybinds from before SC Glass added spare keys
- `tests/` – `python -m unittest discover tests`

## Safety

The companion only listens on your local network and requires the PIN. It never holds a key longer than
30 seconds and releases everything the moment a device disconnects or sleeps. Sequences are capped at 64
steps. It only sends input you could send yourself, like a macro keyboard or Stream Deck.

## Status

Tested end to end in dry-run mode (keys logged instead of pressed), including Game.log tailing, ship
detection, deck switching, sequences, every control type, the editor, share codes, the setup page,
spare-key wiring with backup and undo, and the tablet welcome. The Windows input
path, vJoy and the PC overlay are written to Windows' documented APIs but haven't been exercised on a
Windows PC with Star Citizen yet.

See `THIRD_PARTY.md` for credits.
