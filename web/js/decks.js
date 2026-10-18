"use strict";
/* =====================================================================================
   BUILT-IN DECKS
   A deck is pages -> panels -> controls. Each control has a kind (k):
     pulse   one press                         a
     cycle   press + state lamp                a, s (state key), lamp
     sel     one of a group (operator mode)    a, g (group key), val, back
     hold    pressed while touched             a
     guard   flip the guard, then press        a, tone
     rocker  two halves, repeats while held    dn, up, labels
     macro   a sequence of actions             steps: [{a, if, set, after, ms}]
     slider  pips, sends steps to reach value  s, dn, up, max
     dial    rotary encoder, one step / detent dn, up
     selector rotary switch, one action / pos  g, opts: [{val, lg, a}]
     lever   throttle; vJoy axis or steps      axis, dn, up, s, spring
     pad     trackpad, moves the mouse         sens
     info    live game data                    src
   w / h span grid columns / rows.  Decks are plain JSON: export, share and edit them.
   ===================================================================================== */
const P = (a, lg, x = {}) => ({ k: "pulse", a, lg, ...x });
const C = (a, lg, s, lamp = "onoff", x = {}) => ({ k: "cycle", a, lg, s, lamp, ...x });
const H = (a, lg, x = {}) => ({ k: "hold", a, lg, ...x });
const G = (a, lg, tone = "", x = {}) => ({ k: "guard", a, lg, tone, ...x });
const R = (lg, dn, up, labels, x = {}) => ({ k: "rocker", lg, dn, up, ...(labels ? { labels } : {}), ...x });
const M = (lg, steps, x = {}) => ({ k: "macro", lg, steps, ...x });
const SEL = (a, lg, val, back, x = {}) => ({ k: "sel", a, lg, g: "op", val, ...(back ? { back } : {}), ...x });
const SLD = (lg, s, dn, up, x = {}) => ({ k: "slider", lg, s, dn, up, max: 4, h: 2, ...x });
const DIAL = (lg, dn, up, x = {}) => ({ k: "dial", lg, dn, up, ...x });
const PANEL = (t, c, items, x = {}) => ({ t, c, items, ...x });
const INFO = (src, w, h, x = {}) => ({ k: "info", src, w, h, ...x });

const STEPS = {
  combatReady: [
    { a: "mm", if: { mm: "NAV" }, set: { mm: "SCM" }, after: 2500 },
    { a: "shd", if: { shd: 0 }, set: { shd: 1 } },
    { a: "wpn", if: { wpn: 0 }, set: { wpn: 1 } },
    { a: "gimbal", if: { gimbal: "FIXED" }, set: { gimbal: "GIMBAL" } },
    { a: "gear", if: { gear: "DOWN" }, set: { gear: "UP" } },
  ],
  travel: [
    { a: "gear", if: { gear: "DOWN" }, set: { gear: "UP" }, after: 300 },
    { a: "mm", if: { mm: "SCM" }, set: { mm: "NAV" } },
  ],
  landing: [
    { a: "mm", if: { mm: "NAV" }, set: { mm: "SCM" }, after: 2500 },
    { a: "atc" },
    { a: "gear", if: { gear: "UP" }, set: { gear: "DOWN" } },
  ],
  shutdown: [
    { a: "lights", if: { lights: 1 }, set: { lights: 0 } },
    { a: "power", if: { power: 1 }, set: { power: 0, thr: 0, shd: 0, wpn: 0 } },
  ],
  panic: [{ a: "noise" }, { a: "decoy", ms: 700 }],
  startMining: [
    { a: "mm", if: { mm: "NAV" }, set: { mm: "SCM" }, after: 2500 },
    { a: "mine", if: { op: { ne: "MINE" } }, set: { op: "MINE" } },
  ],
  stopMining: [{ a: "mine", if: { op: "MINE" }, set: { op: "GUNS" } }],
  startSalvage: [
    { a: "mm", if: { mm: "NAV" }, set: { mm: "SCM" }, after: 2500 },
    { a: "salv", if: { op: { ne: "SALV" } }, set: { op: "SALV" } },
  ],
  openCargo: [
    { a: "doorlock", if: { doorlock: "LOCKED" }, set: { doorlock: "OPEN" }, after: 300 },
    { a: "doors", if: { doors: "SHUT" }, set: { doors: "OPEN" } },
    { a: "portlock", if: { portlock: "LOCKED" }, set: { portlock: "OPEN" } },
  ],
  secureShip: [
    { a: "doors", if: { doors: "OPEN" }, set: { doors: "SHUT" }, after: 400 },
    { a: "doorlock", if: { doorlock: "OPEN" }, set: { doorlock: "LOCKED" } },
    { a: "portlock", if: { portlock: "OPEN" }, set: { portlock: "LOCKED" } },
  ],
};

const FLIGHT_READY = P("flightready", "Flight ready", { sets: { power: 1, thr: 1, shd: 1, wpn: 1 } });
const POWER_PANEL = () => PANEL("Power", 5, [FLIGHT_READY, C("power", "Power", "power"), C("thr", "Engines", "thr"),
  C("shd", "Shields", "shd"), C("wpn", "Weapons", "wpn")]);
const LANDING_PANEL = () => PANEL("Landing", 5, [C("gear", "Gear", "gear", "gear"), C("vtol", "VTOL", "vtol"),
  P("atc", "Request landing"), P("autoland", "Autoland"), P("loadreq", "Request loading")]);
const EMERGENCY_PANEL = () => PANEL("Emergency", 2, [P("exit", "Exit seat"), G("emexit", "Emergency exit"),
  G("eject", "Eject", "red"), G("selfd", "Self destruct", "red")], { danger: true });
const SEQ_PANEL = (items, c = 4) => PANEL("Sequences", c, items);
const POWER_DIST = () => PANEL("Power distribution", 4, [SLD("Weapons", "pW", "pwdn", "pwup", { tone: "red" }),
  SLD("Engines", "pE", "pedn", "peup", { tone: "amber" }), SLD("Shields", "pS", "psdn", "psup", { tone: "blue" }),
  P("preset", "Balance", { h: 2, sets: { pW: 2, pE: 2, pS: 2 } })]);
const OP_SELECTOR = () => ({ k: "selector", lg: "Operator mode", g: "op", w: 2, h: 2, opts: [
  { val: "GUNS", lg: "GUNS", a: "guns" }, { val: "MSL", lg: "MSL", a: "msl" },
  { val: "SCAN", lg: "SCAN", a: "scanset" }, { val: "QT", lg: "QT", a: "qtset" }] });
const CM_PANEL = () => PANEL("Countermeasures", 2, [H("decoy", "Decoy"), P("noise", "Noise"),
  R("Decoy burst", "burstdn", "burstup"), M("Panic", STEPS.panic, { tone: "amber" })]);
const TARGETING = (c = 8) => PANEL("Targeting", c, [P("tview", "In view"), P("thost", "Hostiles"), P("tatk", "Attackers"),
  P("tfr", "Friendlies"), P("tall", "All"), P("tsub", "Subtarget"), P("tunlock", "Unlock"),
  C("autotgt", "Auto target", "autotgt", "auto"), C("lookah", "Look ahead", "lookah"), P("hail", "Hail"),
  P("pin1", "Pin 1"), P("pin2", "Pin 2"), P("pin3", "Pin 3"), P("lock1", "Lock pin 1"), P("lock2", "Lock pin 2"), P("lock3", "Lock pin 3")]);
const WEAPONS = () => PANEL("Weapons", 3, [C("gimbal", "Gimbal", "gimbal", "gimbal"), P("aimcyc", "Aim assist"),
  R("Wpn group", "preup", "predn", ["‹", "›"]), P("mslarm", "Arm +1"), P("mslrst", "Reset armed"),
  R("Missile type", "mslprev", "mslnext", ["‹", "›"])]);
const SCANNING = () => PANEL("Scanning", 2, [SEL("scan", "Scan mode", "SCAN", "GUNS"), H("ping", "Ping"),
  R("Scan tab", "stabp", "stabn", ["‹", "›"]), R("Scan page", "spagep", "spagen", ["▲", "▼"])]);
const MINING = () => PANEL("Mining", 4, [SEL("mine", "Mining mode", "MINE", "GUNS"), P("laser", "Laser mode"),
  DIAL("Laser power", "mpdn", "mpup"), P("cons1", "Module 1"), P("cons2", "Module 2"), P("cons3", "Module 3"),
  P("consp", "Fixed module"), G("jett", "Jettison volatile")]);
const SALVAGE = () => PANEL("Salvage", 4, [SEL("salv", "Salvage mode", "SALV", "GUNS"),
  C("fireL", "Left beam", "fireL", "firing"), C("fireR", "Right beam", "fireR", "firing"),
  C("fireF", "Fracture", "fireF", "firing"), C("fireD", "Disintegrate", "fireD", "firing"),
  P("sgimb", "Gimbal"), P("sgrst", "Center gimbal"), P("sfocus", "Focus all")]);
const QUICK_FLIGHT = () => PANEL("Flight", 3, [C("mm", "Master mode", "mm", "mm"), P("qt", "Engage QT"),
  C("gear", "Gear", "gear", "gear"), C("lights", "Lights", "lights"), P("atc", "Request landing"), FLIGHT_READY]);

const PAGES = {
  flight: () => ({ id: "flight", name: "Flight", panels: [
    POWER_PANEL(), LANDING_PANEL(),
    PANEL("Navigation", 3, [C("mm", "Master mode", "mm", "mm"), P("qt", "Engage QT"), C("decoup", "Decoupled", "decoup"),
      P("thrswap", "Throttle mode"), C("rotlock", "Rotation lock", "rotlock"), C("esp", "ESP", "esp")]),
    PANEL("Exterior", 2, [C("lights", "Lights", "lights"), C("doors", "Doors", "doors", "doors"),
      C("doorlock", "Door locks", "doorlock", "locks"), C("portlock", "Port locks", "portlock", "locks")]),
    PANEL("Thrust", 3, [{ k: "lever", lg: "Throttle", s: "thr_lever", axis: "z", dn: "spddn", up: "spdup", steps: 10, h: 2 },
      DIAL("Speed limit", "spddn", "spdup"), DIAL("Accel limit", "accdn", "accup"), H("boost", "Boost"), H("brake", "Space brake")]),
    EMERGENCY_PANEL(),
    SEQ_PANEL([M("Combat ready", STEPS.combatReady, { tone: "red" }), M("Travel", STEPS.travel, { tone: "blue" }),
      M("Landing prep", STEPS.landing, { tone: "blue" }), M("Shut down", STEPS.shutdown, { tone: "amber" })]),
  ]}),
  combat: () => ({ id: "combat", name: "Combat", panels: [
    PANEL("Operator mode", 2, [OP_SELECTOR()]), POWER_DIST(), WEAPONS(), CM_PANEL(), TARGETING(),
  ]}),
  ops: () => ({ id: "ops", name: "Ops", panels: [SCANNING(), MINING(), SALVAGE()] }),
  crew: () => ({ id: "crew", name: "Crew", panels: [
    PANEL("mobiGlas", 2, [P("mobi", "mobiGlas"), P("map", "Starmap"), P("contacts", "Contacts"), P("chat", "Chat")]),
    PANEL("View", 3, [P("cam", "Camera"), H("freelook", "Free look"), H("lookbk", "Look behind"), P("visor", "Wipe visor"),
      C("htrack", "Head track", "htrack"), P("mfdnext", "Next MFD")]),
    PANEL("Invites", 1, [P("accept", "Accept"), P("decline", "Decline")]),
    PANEL("Hand signals", 3, [P("sgfwd", "Forward"), P("sgleft", "Left"), P("sgright", "Right"), P("sgstop", "Stop"),
      P("sgyes", "Yes"), P("sgno", "No")]),
  ]}),
  onfoot: () => ({ id: "onfoot", name: "On foot", panels: [
    PANEL("Weapons", 3, [P("wprim", "Primary"), P("wsec", "Secondary"), P("wside", "Sidearm"), P("wgadget", "Gadget"),
      P("wmelee", "Melee"), P("wfists", "Unarmed")]),
    PANEL("Kit", 3, [P("reload", "Reload"), P("holster", "Holster"), P("firemode", "Fire mode"),
      R("Zeroing", "zerodn", "zeroup"), C("helmet", "Helmet", "helmet", "auto"), C("flash", "Flashlight", "flash")]),
    PANEL("Cursor", 2, [{ k: "pad", lg: "Trackpad", w: 2, h: 2, sens: 1.6 }]),
    PANEL("Downed", 1, [G("revive", "Call for revive", "amber"), G("respawn", "Respawn", "red")], { danger: true }),
  ]}),
  status: () => ({ id: "status", name: "Status", panels: [
    PANEL("Ship", 3, [INFO("ship", 3, 2)]), PANEL("Location", 3, [INFO("location", 3, 2)]),
    PANEL("Session", 3, [INFO("session", 3, 2)]),
    PANEL("Market", 5, [INFO("market", 5, 3)]), PANEL("Log", 4, [INFO("feed", 4, 3)]),
  ]}),
};

const BUILTIN_DECKS = [
  { id: "standard", name: "Standard", builtin: true, skin: "gunmetal", roles: [],
    about: "Everything, for any ship.",
    pages: ["flight", "combat", "ops", "crew", "onfoot", "status"].map(p => PAGES[p]()) },
  { id: "fighter", name: "Fighter", builtin: true, skin: "aegis", roles: ["military", "bomber"],
    about: "Power, missiles, countermeasures and targeting up front.",
    pages: [{ id: "dogfight", name: "Dogfight", panels: [
      PANEL("Operator mode", 2, [OP_SELECTOR()]), POWER_DIST(), CM_PANEL(),
      SEQ_PANEL([M("Combat ready", STEPS.combatReady, { tone: "red" }), M("Travel", STEPS.travel, { tone: "blue" }),
        M("Landing prep", STEPS.landing, { tone: "blue" }), FLIGHT_READY], 2),
      PANEL("Weapons", 4, [C("gimbal", "Gimbal", "gimbal", "gimbal"), P("aimcyc", "Aim assist"), R("Wpn group", "preup", "predn", ["‹", "›"]),
        H("boost", "Boost"), P("mslarm", "Arm +1"), P("mslrst", "Reset armed"), R("Missile type", "mslprev", "mslnext", ["‹", "›"]),
        C("decoup", "Decoupled", "decoup")]),
      PANEL("Targeting", 6, [P("thost", "Hostiles"), P("tatk", "Attackers"), P("tview", "In view"), P("tsub", "Subtarget"),
        P("tunlock", "Unlock"), C("autotgt", "Auto target", "autotgt", "auto"), P("pin1", "Pin 1"), P("pin2", "Pin 2"),
        P("lock1", "Lock pin 1"), P("lock2", "Lock pin 2"), P("hail", "Hail"), C("lookah", "Look ahead", "lookah")]),
    ]}, PAGES.flight(), PAGES.status()] },
  { id: "mining", name: "Mining", builtin: true, skin: "misc", roles: ["mining"],
    about: "Laser, modules and scanning on one page, with live ore prices.",
    pages: [{ id: "mine", name: "Mining", panels: [
      PANEL("Mining head", 4, [SEL("mine", "Mining mode", "MINE", "GUNS"), C("mfire", "Laser", "mfire", "firing"), P("laser", "Laser mode"),
        DIAL("Laser power", "mpdn", "mpup"), P("cons1", "Module 1"), P("cons2", "Module 2"), P("cons3", "Module 3"), P("consp", "Fixed module")]),
      SCANNING(),
      QUICK_FLIGHT(),
      PANEL("Run", 2, [M("Start mining", STEPS.startMining, { tone: "amber" }), M("Stop mining", STEPS.stopMining),
        M("Travel", STEPS.travel, { tone: "blue" }), G("jett", "Jettison volatile")]),
      PANEL("Market", 6, [INFO("market", 6, 2, { commodity: "Quantanium" })]),
      PANEL("Ship", 3, [INFO("ship", 3, 2)]),
    ]}, PAGES.flight(), PAGES.status()] },
  { id: "salvage", name: "Salvage", builtin: true, skin: "drake", roles: ["salvage"],
    about: "Beams, heads and gimbal for Vulture and Reclaimer crews.",
    pages: [{ id: "salvage", name: "Salvage", panels: [
      SALVAGE(),
      PANEL("Heads", 2, [P("sfocL", "Focus left"), P("sfocR", "Focus right"), P("sfocF", "Focus fracture"), P("saxis", "Spacing axis")]),
      PANEL("Run", 2, [M("Start salvage", STEPS.startSalvage, { tone: "amber" }), M("Travel", STEPS.travel, { tone: "blue" }),
        SCANNING().items[0], H("ping", "Ping")]),
      QUICK_FLIGHT(),
      PANEL("Market", 6, [INFO("market", 6, 2, { commodity: "Recycled Material Composite" })]),
      PANEL("Ship", 3, [INFO("ship", 3, 2)]),
    ]}, PAGES.flight(), PAGES.status()] },
  { id: "hauler", name: "Hauler", builtin: true, skin: "anvil", roles: ["cargo"],
    about: "Doors, locks and loading requests, with a trade price board.",
    pages: [{ id: "haul", name: "Hauling", panels: [
      PANEL("Cargo bay", 4, [C("doors", "Doors", "doors", "doors"), C("doorlock", "Door locks", "doorlock", "locks"),
        C("portlock", "Port locks", "portlock", "locks"), P("loadreq", "Request loading"),
        P("atc", "Request landing"), C("gear", "Gear", "gear", "gear"), C("vtol", "VTOL", "vtol"), C("lights", "Lights", "lights")]),
      PANEL("Navigation", 3, [C("mm", "Master mode", "mm", "mm"), P("qt", "Engage QT"), P("autoland", "Autoland"),
        FLIGHT_READY, C("decoup", "Decoupled", "decoup"), H("brake", "Space brake")]),
      PANEL("Sequences", 2, [M("Travel", STEPS.travel, { tone: "blue" }), M("Landing prep", STEPS.landing, { tone: "blue" }),
        M("Open cargo", STEPS.openCargo, { tone: "amber" }), M("Secure ship", STEPS.secureShip)]),
      PANEL("Market", 6, [INFO("market", 6, 2, { commodity: "Laranite" })]),
      PANEL("Ship", 3, [INFO("ship", 3, 2)]),
    ]}, PAGES.flight(), PAGES.status()] },
  { id: "edge", name: "Edge strip", builtin: true, skin: "gunmetal", roles: [],
    about: "One wide row for a Xeneon Edge or other touch strip.",
    pages: [{ id: "strip", name: "Strip", panels: [
      PANEL("Power", 3, [FLIGHT_READY, C("power", "Power", "power"), C("thr", "Engines", "thr"), C("shd", "Shields", "shd"),
        C("wpn", "Weapons", "wpn"), C("lights", "Lights", "lights")]),
      PANEL("Flight", 3, [C("mm", "Master mode", "mm", "mm"), P("qt", "Engage QT"), C("gear", "Gear", "gear", "gear"),
        C("vtol", "VTOL", "vtol"), P("atc", "Request landing"), P("autoland", "Autoland")]),
      POWER_DIST(),
      PANEL("Combat", 4, [H("decoy", "Decoy"), P("noise", "Noise"), C("gimbal", "Gimbal", "gimbal", "gimbal"), P("opcycle", "Next mode"),
        P("thost", "Hostiles"), P("tview", "In view"), P("mslarm", "Arm +1"), C("decoup", "Decoupled", "decoup")]),
      SEQ_PANEL([M("Combat ready", STEPS.combatReady, { tone: "red" }), M("Travel", STEPS.travel, { tone: "blue" }),
        M("Landing prep", STEPS.landing, { tone: "blue" }), M("Shut down", STEPS.shutdown, { tone: "amber" })], 2),
      EMERGENCY_PANEL(),
    ]}] },
];

/* Which built-in deck suits a ship, from its UEX roles. Order matters: a Cutlass is cargo AND military. */
function deckForRoles(roles) {
  const r = new Set(roles || []);
  if (r.has("mining")) return "mining";
  if (r.has("salvage")) return "salvage";
  if (r.has("cargo") && !r.has("military") && !r.has("bomber")) return "hauler";
  if (r.has("military") || r.has("bomber")) return "fighter";
  return "standard";
}
