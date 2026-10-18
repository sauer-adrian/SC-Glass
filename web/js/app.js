"use strict";
/* =====================================================================================
   SC Glass deck runtime: state, bindings, link to the PC, rendering, macros, game events.
   Loaded after catalog.js and decks.js; controls.js, info.js and editor.js build on it.
   ===================================================================================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MODS = ["lctrl", "rctrl", "lshift", "rshift", "lalt", "ralt"];
const KEY_NAMES = { mouse1: "LMB", mouse2: "RMB", mouse3: "MMB", mouse4: "MB4", mouse5: "MB5",
  mwheel_up: "WHEEL▲", mwheel_down: "WHEEL▼", backspace: "BKSP", lbracket: "[", rbracket: "]",
  comma: ",", period: ".", slash: "/", backslash: "\\", semicolon: ";", apostrophe: "'", grave: "`",
  minus: "-", equals: "=", escape: "ESC", space: "SPACE", np_divide: "NUM/", np_multiply: "NUM*",
  np_add: "NUM+", np_subtract: "NUM-", np_period: "NUM.", np_enter: "NUMENT", up: "↑", down: "↓",
  left: "←", right: "→", pgup: "PGUP", pgdn: "PGDN", oem_102: "<>", capslock: "CAPS" };
const fmtTok = t => KEY_NAMES[t] || (t.startsWith("np_") ? "NUM" + t.slice(3) : t.startsWith("vjoy_b") ? "JOY" + t.slice(6) : t.toUpperCase());
const fmtKeys = k => k ? normKeys(k).split("+").map(fmtTok).join("+") : "";
function normKeys(k) {
  const toks = k.toLowerCase().split("+").map(s => s.trim()).filter(Boolean);
  return [...MODS.filter(m => toks.includes(m)), ...toks.filter(t => !MODS.includes(t))].join("+");
}
const SC_MODE = { tap: "tap", tap_quicker: "tap", press: "press", press_quicker: "press",
  delayed_press: "long:450", delayed_press_quicker: "long:300", delayed_press_medium: "long:750",
  delayed_press_long: "long:1800", delayed_hold: "long:450", delayed_hold_long: "long:1800",
  delayed_hold_no_retrigger: "long:300", double_tap: "dtap", double_tap_nonblocking: "dtap" };
function spec(mode) {
  if (mode === "hold") return { hold: true, ms: 300 };
  if (mode === "dtap") return { ms: 50, repeat: 2 };
  if (mode && mode.startsWith("long:")) return { ms: +mode.slice(5) || 450 };
  if (mode === "tap") return { ms: 50 };
  return { ms: 70 };
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const store = {
  get(k, d) { try { const v = localStorage.getItem("scg." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("scg." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("scg." + k); } catch {} },
};
const PARAMS = new URLSearchParams(location.search);

/* =====================================================================================
   State
   ===================================================================================== */
const S = {
  live: false, demo: false, ws: null, authed: false, seq: 0, pending: new Map(),
  sc: {}, custom: {}, am: null, focus: null, backend: "", version: "", platform: "", settings: {},
  states: { ...STATE_DEFAULTS, ...store.get("states", {}) },
  userDecks: [], deckId: store.get("deck", "standard"), page: store.get("page", ""),
  mode: "play", lat: null, game: null, vjoy: { ok: false, axes: [] }, overlay: { available: false, monitors: [] },
  opt: { sound: store.get("sound", true), haptic: store.get("haptic", true), follow: store.get("follow", true),
         skin: store.get("skin", "") },
  overlayMode: PARAMS.has("overlay"),
};

/* =====================================================================================
   Bindings. A ref is a catalog id ("gear") or raw keys ("keys:lalt+f13|tap").
   ===================================================================================== */
function actDef(ref) {
  if (typeof ref === "string" && ref.startsWith("keys:")) {
    const [keys, mode] = ref.slice(5).split("|");
    return { act: null, keys: keys || "", mode: mode || "press", name: "Custom " + fmtKeys(keys || ""), raw: true };
  }
  const d = A[ref];
  return d ? { act: d[0], keys: d[1], mode: d[2], name: d[3] } : null;
}
function binding(ref) {
  const d = actDef(ref);
  if (!d) return { keys: "", mode: "press", src: "none", name: String(ref || "Nothing"), act: null };
  if (d.raw) return { keys: d.keys, mode: d.mode, src: "custom", name: d.name, act: null };
  const c = S.custom[d.act], g = S.sc[d.act];
  if (c) return { keys: c.keys || "", mode: c.mode || d.mode, src: "custom", name: d.name, act: d.act };
  if (g) return { keys: g.keys || "", mode: (g.mode && SC_MODE[g.mode]) || d.mode, src: g.keys ? "game" : "cleared", name: d.name, act: d.act };
  return { keys: d.keys, mode: d.mode, src: d.keys ? "default" : "none", name: d.name, act: d.act };
}
/* item.a can be a list: the first bound action wins (e.g. "set NAV" if bound, else the NAV/SCM toggle). */
function pick(refs) {
  const list = Array.isArray(refs) ? refs : [refs];
  for (const r of list) { const b = binding(r); if (b.keys) return { ref: r, ...b }; }
  return { ref: list[0], ...binding(list[0]) };
}

/* =====================================================================================
   Decks
   ===================================================================================== */
function allDecks() { return [...BUILTIN_DECKS, ...S.userDecks]; }
function getDeck(id) { return allDecks().find(d => d.id === id); }
function currentDeck() {
  if (S.mode === "edit" && EDIT.deck) return EDIT.deck;
  return getDeck(S.deckId) || BUILTIN_DECKS[0];
}
function useDeck(id, why) {
  const d = getDeck(id);
  if (!d) return;
  S.deckId = id; store.set("deck", id);
  if (S.game && S.game.ship && why === "manual") {
    const mem = store.get("shipDeck", {}); mem[S.game.ship] = id; store.set("shipDeck", mem);
  }
  S.page = d.pages[0]?.id || ""; store.set("page", S.page);
  renderDeck();
}
function deckForShip(ship, roles) {
  const mem = store.get("shipDeck", {});
  if (mem[ship] && getDeck(mem[ship])) return mem[ship];
  const low = ship.toLowerCase();
  for (const d of allDecks()) if ((d.match || []).some(m => m && low.includes(String(m).toLowerCase()))) return d.id;
  const want = deckForRoles(roles);
  const fork = S.userDecks.find(d => d.forked_from === want);
  return fork ? fork.id : want;
}
function saveUserDecks() { if (S.demo) store.set("demoDecks", S.userDecks); }

/* =====================================================================================
   Rendering
   ===================================================================================== */
const deckEl = $("#deck");
const ITEMS = new Map();   // element -> { item, panel, page }
let gridObserver = null;

function applySkin() {
  const skin = S.opt.skin || currentDeck().skin || "gunmetal";
  if (skin === "gunmetal") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--deck").trim() || "#121618";
}

function renderDeck() {
  const deck = currentDeck();
  if (!deck.pages.some(p => p.id === S.page)) S.page = deck.pages[0]?.id || "";
  applySkin();
  const tabs = deck.pages.map(p => `<button class="tab" role="tab" data-page="${esc(p.id)}">${esc(p.name)}</button>`).join("");
  $("#tabsTop").innerHTML = tabs; $("#tabsBottom").innerHTML = tabs;
  $$(".tab").forEach(t => t.addEventListener("click", () => showPage(t.dataset.page)));
  ITEMS.clear();
  if (gridObserver) gridObserver.disconnect();
  gridObserver = new ResizeObserver(entries => {
    for (const e of entries) {
      const g = e.target, cols = getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean);
      const colw = cols.length ? parseFloat(cols[0]) : 90;
      let rowh = Math.max(56, Math.round(colw * .86));
      if (innerWidth / innerHeight > 2.4 && innerHeight < 820) {
        /* touch strips (Xeneon Edge): fill the height with two rows instead of leaving it empty */
        const avail = (deckEl.clientHeight - 24 - 46 - 10) / 2;
        rowh = Math.round(Math.max(rowh, Math.min(avail, colw * 1.9)));
      }
      g.style.setProperty("--rowh", rowh + "px");
    }
  });
  $$(".page", deckEl).forEach(p => p.remove());
  for (const page of deck.pages) {
    const sec = document.createElement("section");
    sec.className = "page"; sec.dataset.page = page.id; sec.setAttribute("role", "tabpanel");
    page.panels.forEach((pn, pi) => sec.append(buildPanel(page, pn, pi)));
    if (S.mode === "edit") {
      const add = document.createElement("button");
      add.className = "addpanel"; add.type = "button"; add.textContent = "+ Add panel";
      add.addEventListener("click", () => EDITOR.addPanel(page));
      sec.append(add);
    }
    deckEl.append(sec);
  }
  showPage(S.page, true);
  renderAll();
  updateDeckChip();
}

function buildPanel(page, pn, pi) {
  const panel = document.createElement("div");
  panel.className = "panel" + (pn.danger ? " danger" : "");
  panel.style.setProperty("--c", Math.max(1, Math.min(12, pn.c || 3)));
  panel.innerHTML = `<h2 class="plc"></h2><div class="ptools"></div><div class="grid"></div>`;
  panel.querySelector(".plc").textContent = pn.t || "";
  const grid = panel.querySelector(".grid");
  for (const [ii, item] of (pn.items || []).entries()) {
    const ctl = CONTROLS[item.k] || CONTROLS.pulse;
    const cell = document.createElement("div");
    cell.className = "cell k-" + item.k;
    const w = Math.max(1, Math.min(item.w || 1, pn.c || 1)), h = Math.max(1, Math.min(item.h || 1, 6));
    if (w > 1) cell.style.gridColumn = `span ${w}`;
    if (h > 1) cell.style.gridRow = `span ${h}`;
    cell.append(ctl.build(item, cell));
    if ((pn.items || []).length === 1 && String(item.lg || "").toLowerCase() === String(pn.t || "").toLowerCase()) cell.classList.add("solo");
    if (item.k === "info" && (pn.items || []).length === 1) cell.classList.add("solo");
    ITEMS.set(cell, { item, panel: pn, page, pi, ii });
    grid.append(cell);
  }
  if (S.mode === "edit") {
    const add = document.createElement("button");
    add.className = "addtile"; add.type = "button"; add.textContent = "+ Add";
    add.addEventListener("click", () => EDITOR.addItem(page, pn));
    grid.append(add);
    const tools = panel.querySelector(".ptools");
    tools.innerHTML = `<button type="button" data-t="left" aria-label="Move panel earlier">◀</button><button type="button" data-t="right" aria-label="Move panel later">▶</button><button type="button" data-t="narrow" aria-label="Fewer columns">−</button><button type="button" data-t="wide" aria-label="More columns">+</button><button type="button" data-t="edit" aria-label="Panel settings">✎</button>`;
    tools.addEventListener("click", e => { const b = e.target.closest("button"); if (b) EDITOR.panelTool(page, pn, b.dataset.t); });
  }
  gridObserver.observe(grid);
  return panel;
}

function showPage(id, quiet) {
  const deck = currentDeck();
  if (!deck.pages.some(p => p.id === id)) id = deck.pages[0]?.id;
  S.page = id; store.set("page", id);
  $$(".page", deckEl).forEach(p => p.hidden = p.dataset.page !== id);
  $$(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.page === id));
  if (!quiet) deckEl.scrollTop = 0;
}

function renderAll() { for (const [cell, ctx] of ITEMS) (CONTROLS[ctx.item.k] || CONTROLS.pulse).render(ctx.item, cell); }
function renderWhere(pred) { for (const [cell, ctx] of ITEMS) if (pred(ctx.item)) (CONTROLS[ctx.item.k] || CONTROLS.pulse).render(ctx.item, cell); }

function updateDeckChip() {
  const d = currentDeck();
  $("#deckName").textContent = (S.mode === "edit" ? "Editing " : "") + d.name;
  const g = S.game;
  $("#deckShip").textContent = g && g.ship ? (g.example ? "Example: " : "") + g.ship : (S.demo ? "Demo deck" : S.authed ? "No ship detected" : "");
}

/* =====================================================================================
   State changes
   ===================================================================================== */
function setState(k, v, opts = {}) {
  S.states[k] = v; store.set("states", S.states);
  if (!opts.local && S.authed) wsSend({ t: "state", key: k, value: v });
  renderWhere(it => it.s === k || it.g === k || (it.k === "macro"));
}
function setStates(obj, opts = {}) {
  Object.assign(S.states, obj); store.set("states", S.states);
  if (!opts.local && S.authed) wsSend({ t: "states", states: obj });
  renderAll();
}
function lampFor(item) {
  const v = LAMPS[item.lamp] || item.v || LAMPS.onoff;
  const cur = S.states[item.s];
  return v.find(x => String(x[0]) === String(cur)) || v[0];
}
function nextLamp(item) {
  const v = LAMPS[item.lamp] || item.v || LAMPS.onoff;
  const i = v.indexOf(lampFor(item));
  return v[(i + 1) % v.length][0];
}

/* =====================================================================================
   Sending input
   ===================================================================================== */
function wsSend(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
function command(o) {
  if (S.demo) return Promise.resolve({ ok: true });
  if (!S.authed) return Promise.resolve({ ok: false, err: "offline" });
  const id = ++S.seq;
  return new Promise(res => {
    const to = setTimeout(() => { S.pending.delete(id); res({ ok: false, err: "offline" }); }, 4000);
    S.pending.set(id, r => { clearTimeout(to); res(r); });
    wsSend({ ...o, id });
  });
}
function request(o, type) {
  if (!S.authed) return Promise.resolve(null);
  const id = ++S.seq;
  return new Promise(res => {
    const to = setTimeout(() => { S.pending.delete(id); res(null); }, 25000);
    S.pending.set(id, r => { clearTimeout(to); res(r); });
    wsSend({ ...o, id });
  });
}

/* Press an action once. Returns true when the PC accepted it. */
async function fire(ref, el, opts = {}) {
  const b = pick(ref);
  if (!b.keys) { unboundWarn(el, b.name); return false; }
  const sp = { ...spec(b.mode), ...(opts.ms ? { ms: opts.ms } : {}) };
  if (sp.hold) sp.ms = opts.ms || 300;
  if (el) animatePress(el, sp.ms);
  const t0 = performance.now();
  const r = await command({ t: "pulse", keys: b.keys, ms: sp.ms, repeat: sp.repeat || 1 });
  const dt = Math.round(performance.now() - t0);
  const how = sp.repeat ? "double tap" : sp.ms >= 250 ? `hold ${(sp.ms / 1000).toFixed(2).replace(/0$/, "")} s` : "tap";
  if (r.ok) {
    if (!opts.quiet) readout(`<b>${esc(opts.label || b.name)}</b> ▸ ${esc(fmtKeys(b.keys))} · ${how} ${S.demo ? '<span class="x">demo, not sent</span>' : `<em>✓</em> ${dt} ms`}`);
    return true;
  }
  failed(el, opts.label || b.name, r.err);
  return false;
}
function animatePress(el, ms) {
  el.style.setProperty("--dur", ms + "ms");
  el.classList.remove("flash", "run"); void el.offsetWidth;
  el.classList.add("flash"); if (ms >= 250) el.classList.add("run");
  setTimeout(() => el.classList.remove("flash"), 140);
  setTimeout(() => el.classList.remove("run"), ms + 60);
}

/* Holds: key down while the finger is down. */
const HOLDS = new Map();
async function holdStart(el, ref, label) {
  const b = pick(ref);
  if (!b.keys) { unboundWarn(el, b.name); return; }
  sound("click");
  const hid = "h" + (++S.seq);
  HOLDS.set(el, { hid, name: label || b.name });
  el.classList.add("holding");
  readout(`<b>${esc(label || b.name)}</b> ▸ ${esc(fmtKeys(b.keys))} · holding${S.demo ? ' <span class="x">demo, not sent</span>' : ""}`);
  const r = await command({ t: "down", hid, keys: b.keys });
  if (!r.ok) { el.classList.remove("holding"); HOLDS.delete(el); failed(el, label || b.name, r.err); }
}
function holdEnd(el) {
  const h = HOLDS.get(el);
  el.classList.remove("holding");
  if (!h) return;
  HOLDS.delete(el);
  if (S.authed) wsSend({ t: "up", hid: h.hid });
  readout(`<b>${esc(h.name)}</b> released`);
}

/* Macros: conditions are checked against the lights as each step would leave them. */
function condOk(c, work) {
  return Object.entries(c || {}).every(([k, v]) =>
    (v && typeof v === "object" && "ne" in v) ? String(work[k]) !== String(v.ne) : String(work[k]) === String(v));
}
function expandMacro(steps) {
  const work = { ...S.states }, out = [], sets = {}, names = [], missing = [];
  for (const st of steps || []) {
    if (st.wait) { out.push({ wait: +st.wait }); continue; }
    if (st.if && !condOk(st.if, work)) continue;
    if (st.a) {
      const b = pick(st.a);
      if (!b.keys) { missing.push(b.name); continue; }
      const sp = spec(b.mode);
      out.push({ keys: b.keys, ms: +st.ms || (sp.hold ? 300 : sp.ms), repeat: sp.repeat || 1 });
      names.push(b.name);
    }
    if (st.set) { Object.assign(work, st.set); Object.assign(sets, st.set); }
    if (st.after) out.push({ wait: +st.after });
  }
  while (out.length && out[out.length - 1].wait !== undefined) out.pop();
  return { out, sets, names, missing };
}
async function runMacro(item, el) {
  const { out, sets, names, missing } = expandMacro(item.steps);
  if (!out.length) {
    if (missing.length) return unboundWarn(el, missing.join(", "));
    toast(`${item.lg}: nothing to do, the lights say it's already done.`);
    readout(`<b>${esc(item.lg)}</b> nothing to do`);
    return;
  }
  sound("clack");
  const total = out.reduce((a, s) => a + (s.wait || (s.ms * (s.repeat || 1) + 60)), 0);
  animatePress(el, Math.max(300, total));
  const r = await command({ t: "seq", steps: out });
  if (!r.ok) return failed(el, item.lg, r.err);
  setStates(sets);
  readout(`<b>${esc(item.lg)}</b> ▸ ${esc(names.join(" → "))}${S.demo ? ' <span class="x">demo, not sent</span>' : " <em>✓</em>"}`);
  if (missing.length) toast(`${item.lg} skipped ${missing.join(", ")}: no key bound.`, "warn");
}

function unboundWarn(el, name) {
  if (el) { el.classList.add("err"); setTimeout(() => el.classList.remove("err"), 600); }
  sound("err");
  toast(`${name} has no key yet. Bind it in Star Citizen's keybinding menu, or tap KEYS here and set one.`, "warn");
  readout(`<b>${esc(name)}</b> <span class="x">has no key</span>`);
}
function failed(el, name, err) {
  if (el) { el.classList.add("err"); setTimeout(() => el.classList.remove("err"), 700); }
  sound("err");
  if (err === "focus") {
    toast("Star Citizen isn't the active window on your PC. Click into the game, then try again.", "warn");
    readout(`<b>${esc(name)}</b> <span class="x">held back: game not in front</span>`);
  } else if (err === "offline") {
    toast("Not connected to your PC. Check that SC Glass is running and you're on the same Wi-Fi.", "bad");
    readout(`<b>${esc(name)}</b> <span class="x">not sent: no link</span>`);
  } else {
    toast(`${name} wasn't sent: ${err || "unknown error"}`, "bad");
    readout(`<b>${esc(name)}</b> <span class="x">failed</span>`);
  }
}

/* =====================================================================================
   Press handling shared by every push-type control
   ===================================================================================== */
function bindPress(el, o) {
  let p = null;
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("pointerdown", e => {
    if (e.button > 0 || S.mode !== "play") return;
    try { el.setPointerCapture(e.pointerId); } catch {}
    p = { x: e.clientX, y: e.clientY, moved: false, long: false, fired: false, hold: o.hold ? o.hold() : false };
    el.classList.add("down"); wake();
    if (p.hold) { o.holdStart(); return; }
    if (o.repeat) {
      p.fired = true; o.tap(false);
      p.rt = setTimeout(function rep() { o.tap(true); p.rt = setTimeout(rep, o.repeat); }, 420);
    }
    if (o.long) p.lt = setTimeout(() => { p.long = true; el.classList.remove("down"); o.long(); }, 650);
  });
  el.addEventListener("pointermove", e => {
    if (!p || p.hold) return;
    if (Math.abs(e.clientX - p.x) > 14 || Math.abs(e.clientY - p.y) > 14) {
      p.moved = true; clearTimeout(p.lt); clearTimeout(p.rt); el.classList.remove("down");
    }
  });
  const end = cancelled => {
    if (!p) return;
    clearTimeout(p.lt); clearTimeout(p.rt);
    el.classList.remove("down");
    if (p.hold) o.holdEnd();
    else if (!cancelled && !p.moved && !p.long && !p.fired) o.tap(false);
    p = null;
  };
  el.addEventListener("pointerup", () => end(false));
  el.addEventListener("pointercancel", () => end(true));
  el.addEventListener("lostpointercapture", () => { if (p && p.hold) end(true); });
  el.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (S.mode === "play") o.tap(false, true);
  });
}

/* Edit and key modes take over taps on the whole deck. */
deckEl.addEventListener("pointerdown", e => {
  if (S.mode === "play") return;
  if (e.target.closest(".ptools, .addtile, .addpanel, .info select, .info button")) return;
  e.stopPropagation();
}, true);
deckEl.addEventListener("click", e => {
  if (S.mode === "play") return;
  if (e.target.closest(".ptools, .addtile, .addpanel, .info select, .info button")) return;
  e.stopPropagation(); e.preventDefault();
  if (S.mode === "keys") {
    const t = e.target.closest("[data-refs]");
    if (!t) return;
    const refs = JSON.parse(t.dataset.refs).filter(Boolean);
    if (refs.length === 1) openBind(refs[0]); else if (refs.length) openChooser(refs);
    else toast("This control doesn't send keys.");
  } else if (S.mode === "edit") {
    const cell = e.target.closest(".cell");
    if (cell && ITEMS.has(cell)) EDITOR.openItem(ITEMS.get(cell), cell);
  }
}, true);

/* =====================================================================================
   Feedback: synthesized switch sounds, haptics, readout, toast
   ===================================================================================== */
let actx = null;
function sound(kind = "click") {
  if (S.opt.haptic && navigator.vibrate) { try { navigator.vibrate({ click: 9, clack: 18, snap: 14, tick: 5, on: 10, off: 10, err: [20, 40, 20], warn: 25 }[kind] || 9); } catch {} }
  if (!S.opt.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, out = actx.createGain();
    out.gain.value = 0.32; out.connect(actx.destination);
    const noise = (dur, freq, q, gain, at = 0) => {
      const len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const s = actx.createBufferSource(); s.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
      const g = actx.createGain(); g.gain.value = gain;
      s.connect(f).connect(g).connect(out); s.start(t + at);
    };
    const tone = (f0, f1, dur, gain, at = 0, type = "sine") => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(gain, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(out); o.start(t + at); o.stop(t + at + dur + .02);
    };
    if (kind === "click") noise(.012, 3200, 1.4, 1);
    else if (kind === "clack") { noise(.02, 1800, 1.1, 1.2); tone(180, 90, .05, .25); }
    else if (kind === "snap") { noise(.008, 4200, 2, 1); noise(.03, 900, .8, .6, .03); }
    else if (kind === "tick") noise(.006, 5200, 3, .7);
    else if (kind === "on") { noise(.01, 3000, 1.4, .8); tone(880, 1320, .06, .12, .01); }
    else if (kind === "off") { noise(.01, 3000, 1.4, .8); tone(1100, 660, .06, .1, .01); }
    else if (kind === "warn") { tone(740, 740, .09, .16, 0, "square"); tone(740, 740, .09, .16, .14, "square"); }
    else if (kind === "err") tone(220, 160, .14, .18, 0, "sawtooth");
  } catch {}
}
let toastT;
function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show " + kind;
  clearTimeout(toastT); toastT = setTimeout(() => t.className = "toast " + kind, kind ? 4500 : 2800);
}
function readout(html) { $("#readout").innerHTML = html; }

let wl = null;
async function wake() {
  if (wl || !("wakeLock" in navigator)) return;
  try { wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => wl = null); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { wl = null; wake(); }
  else HOLDS.forEach((_, el) => holdEnd(el));    // never leave a key held when the tablet sleeps
});

/* =====================================================================================
   Link to the PC
   ===================================================================================== */
function setLink(s, text) { const l = $("#linkLamp"); l.dataset.s = s; $("#linkText").textContent = text; }
function setFocusLamp() {
  const l = $("#focusLamp");
  if (!S.authed || S.focus === null || S.focus === undefined || S.overlayMode) { l.hidden = true; return; }
  l.hidden = false;
  l.dataset.s = S.focus ? "ok" : "warn";
  $("#focusText").textContent = S.focus ? "IN GAME" : "GAME NOT IN FRONT";
}
let retry = 0, pingT;
function connect() {
  setLink("wait", "LINKING");
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  S.ws = ws;
  ws.onopen = () => { retry = 0; hello(); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => {
    S.authed = false; clearInterval(pingT);
    for (const [, fn] of S.pending) fn({ ok: false, err: "offline" }); S.pending.clear();
    HOLDS.forEach((_, el) => el.classList.remove("holding")); HOLDS.clear();
    setLink("bad", "NO LINK"); setFocusLamp(); $("#latency").textContent = "";
    setTimeout(connect, Math.min(5000, 800 * ++retry));
  };
}
function hello() {
  const pin = store.get("pin", "");
  if (!pin) return openPin();
  const ua = navigator.userAgent;
  const client = S.overlayMode ? "PC overlay" : /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "deck";
  wsSend({ t: "hello", pin, client });
}
function onMsg(m) {
  switch (m.t) {
    case "welcome": {
      const first = !S.authed;
      S.authed = true; S.version = m.version; S.backend = m.backend; S.platform = m.platform;
      S.sc = m.sc || {}; S.custom = m.custom || {}; S.am = m.actionmaps; S.focus = m.focus; S.settings = m.settings || {};
      S.userDecks = m.decks || []; S.game = m.game; S.vjoy = m.vjoy || { ok: false, axes: [] }; S.overlay = m.overlay || {};
      if (m.states && Object.keys(m.states).length) Object.assign(S.states, m.states);
      else wsSend({ t: "states", states: S.states });
      store.set("states", S.states);
      closePin(); store.del("triedPin");
      setLink("ok", S.backend === "dry-run" ? "DRY RUN" : "LINK");
      setFocusLamp();
      if (!getDeck(S.deckId)) S.deckId = "standard";
      if (first && S.opt.follow && S.game && S.game.ship) {
        const id = deckForShip(S.game.ship, S.game.shipinfo?.roles);
        if (id !== S.deckId) { S.deckId = id; store.set("deck", id); S.page = ""; }
      }
      if (S.mode !== "edit") renderDeck(); else renderAll();
      fillSettings();
      clearInterval(pingT); ping(); pingT = setInterval(ping, 3000);
      break;
    }
    case "denied":
      S.authed = false;
      if (m.reason === "locked") openPin("Too many wrong PINs. Wait a minute, then try again.");
      else { store.del("pin"); openPin(store.get("triedPin") ? "That PIN didn't match. Check the SC Glass window on your PC." : ""); }
      setLink("warn", "PAIR");
      break;
    case "bindings":
      S.sc = m.sc || {}; S.custom = m.custom || {}; S.am = m.actionmaps; renderAll(); fillSettings(); if (bindFor) fillBind(); break;
    case "states":
      Object.assign(S.states, m.states); store.set("states", S.states); renderAll(); break;
    case "focus": S.focus = m.ok; setFocusLamp(); break;
    case "pong": S.lat = Math.round(performance.now() - m.ts); $("#latency").textContent = S.lat + " ms"; break;
    case "ack": case "market": case "commodities": {
      const fn = S.pending.get(m.id); if (fn) { S.pending.delete(m.id); fn(m); } break;
    }
    case "error": toast(m.msg, "bad"); break;
    case "game": onGame(m); break;
    case "decks": {
      S.userDecks = m.decks || [];
      if (S.mode === "edit") { if (m.changed === EDIT.deck?.id) toast(`This deck was changed on ${m.by || "another device"}. Saving here will overwrite it.`, "warn"); }
      else {
        if (!getDeck(S.deckId)) S.deckId = "standard";
        renderDeck();
        if (m.changed && m.changed === S.deckId) toast(`Deck updated from ${m.by || "another device"}.`);
      }
      if (!$("#deckScrim").hidden) fillDeckSheet();
      break;
    }
  }
}
function ping() { wsSend({ t: "ping", ts: performance.now() }); }

/* =====================================================================================
   Game events from Star Citizen's Game.log
   ===================================================================================== */
function onGame(m) {
  const prevShip = S.game?.ship;
  S.game = m.game;
  const ev = m.ev || {};
  const d = ev.data || {};
  if (ev.type === "ship_boarded" && S.game.ship && S.game.ship !== prevShip) {
    const msgs = [`Boarded ${S.game.ship}`];
    if (S.game.own_ship) { setStates({ ...SHIP_STATE_DEFAULTS }, { local: true }); msgs.push("lights reset"); }
    if (S.opt.follow && S.mode !== "edit") {
      const id = deckForShip(S.game.ship, S.game.shipinfo?.roles);
      if (id !== S.deckId) { useDeck(id, "auto"); msgs.push(`${currentDeck().name} deck`); }
    }
    sound("on"); toast(msgs.join(" · ") + ".");
  } else if (ev.type === "ship_exited") {
    readout(`Left <b>${esc(d.ship)}</b>`);
  } else if (ev.type === "game_restarted") {
    setStates({ ...SHIP_STATE_DEFAULTS }, { local: true });
    toast("Star Citizen restarted. Lights reset.");
  } else if (ev.type === "incapacitated") {
    sound("warn"); toast("You're incapacitated. Call for revive is on the On foot page.", "bad");
  } else if (ev.type === "qt_arrived") {
    sound("on"); readout("<b>Quantum</b> arrived");
  } else if (ev.type === "contract_accepted") {
    toast(`Contract accepted: ${d.name}`);
  } else if (ev.type === "armistice_entered" || ev.type === "armistice_exited") {
    readout(`<b>${ev.type === "armistice_entered" ? "Entering" : "Leaving"} armistice zone</b>`);
  }
  updateDeckChip();
  renderWhere(it => it.k === "info");
}

function enterDemo() {
  S.demo = true;
  S.custom = store.get("demoCustom", {});
  S.userDecks = store.get("demoDecks", []);
  S.game = EXAMPLE_GAME;
  setLink("demo", "DEMO");
  readout("Demo deck. Tap anything; nothing reaches a game. Settings explains how to connect your PC.");
  if (!getDeck(S.deckId)) S.deckId = "standard";
  renderDeck(); fillSettings();
}

/* =====================================================================================
   PIN pad
   ===================================================================================== */
let pinBuf = "";
function openPin(err = "") { pinBuf = ""; $("#pinErr").textContent = err; drawPin(); $("#pinScrim").hidden = false; }
function closePin() { $("#pinScrim").hidden = true; }
function drawPin() { $("#pinDisplay").innerHTML = Array.from({ length: 6 }, (_, i) => `<span>${pinBuf[i] ? "•" : ""}</span>`).join(""); }
function buildPad() {
  const pad = $("#pad");
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"]) {
    const b = document.createElement("button");
    b.className = "sw"; b.type = "button";
    b.innerHTML = `<span class="lg"></span>`; b.querySelector(".lg").textContent = k;
    b.setAttribute("aria-label", k === "⌫" ? "Delete" : k);
    b.addEventListener("click", () => {
      sound("click");
      if (k === "⌫") pinBuf = pinBuf.slice(0, -1);
      else if (k === "OK") submitPin();
      else if (pinBuf.length < 6) { pinBuf += k; if (pinBuf.length === 6) setTimeout(submitPin, 120); }
      drawPin();
    });
    pad.append(b);
  }
  document.addEventListener("keydown", e => {
    if ($("#pinScrim").hidden) return;
    if (/^\d$/.test(e.key) && pinBuf.length < 6) { pinBuf += e.key; drawPin(); if (pinBuf.length === 6) submitPin(); }
    if (e.key === "Backspace") { pinBuf = pinBuf.slice(0, -1); drawPin(); }
  });
}
function submitPin() {
  if (pinBuf.length !== 6) { $("#pinErr").textContent = "The PIN has 6 digits."; return; }
  store.set("pin", pinBuf); store.set("triedPin", true);
  $("#pinErr").textContent = "Checking…";
  if (S.ws && S.ws.readyState === 1) hello();
}

/* =====================================================================================
   Key binding sheet
   ===================================================================================== */
const KEY_GROUPS = [
  ["Letters", "abcdefghijklmnopqrstuvwxyz".split("")],
  ["Numbers", "1234567890".split("")],
  ["Function keys", Array.from({ length: 24 }, (_, i) => "f" + (i + 1))],
  ["Numpad", [..."0123456789".split("").map(n => "np_" + n), "np_add", "np_subtract", "np_multiply", "np_divide", "np_period", "np_enter"]],
  ["Navigation", ["up", "down", "left", "right", "home", "end", "pgup", "pgdn", "insert", "delete"]],
  ["Editing", ["space", "tab", "enter", "backspace", "escape", "capslock"]],
  ["Symbols", ["minus", "equals", "lbracket", "rbracket", "semicolon", "apostrophe", "grave", "backslash", "comma", "period", "slash", "oem_102"]],
  ["Modifier keys", ["lshift", "rshift", "lctrl", "rctrl", "lalt", "ralt"]],
  ["Mouse", ["mouse1", "mouse2", "mouse3", "mouse4", "mouse5", "mwheel_up", "mwheel_down"]],
  ["Virtual joystick (vJoy)", Array.from({ length: 32 }, (_, i) => "vjoy_b" + (i + 1))],
];
const MOD_LABEL = { lctrl: "L Ctrl", rctrl: "R Ctrl", lshift: "L Shift", rshift: "R Shift", lalt: "L Alt", ralt: "R Alt" };
function keyOptions() {
  return `<option value="">Not set</option>` + KEY_GROUPS.map(([g, ks]) =>
    `<optgroup label="${g}">${ks.map(k => `<option value="${k}">${esc(fmtTok(k))}${fmtTok(k) !== k.toUpperCase() ? "  (" + k + ")" : ""}</option>`).join("")}</optgroup>`).join("");
}
const KEY_EDITOR = {
  mods: new Set(),
  mount(root) {
    root.querySelector(".k-sel").innerHTML = keyOptions();
    const chips = root.querySelector(".k-mods");
    chips.innerHTML = MODS.map(m => `<button class="chip" type="button" data-m="${m}" aria-pressed="false">${MOD_LABEL[m]}</button>`).join("");
    chips.addEventListener("click", e => {
      const c = e.target.closest(".chip"); if (!c) return;
      const mods = root._mods;
      mods.has(c.dataset.m) ? mods.delete(c.dataset.m) : mods.add(c.dataset.m);
      c.setAttribute("aria-pressed", mods.has(c.dataset.m)); KEY_EDITOR.draw(root);
    });
    root.querySelector(".k-sel").addEventListener("change", () => KEY_EDITOR.draw(root));
    root._mods = new Set();
  },
  set(root, keys, mode) {
    const toks = keys ? normKeys(keys).split("+") : [];
    root._mods = new Set(toks.filter(t => MODS.includes(t)));
    let main = toks.filter(t => !MODS.includes(t)).pop() || "";
    if (!main && toks.length) { main = toks[toks.length - 1]; root._mods.delete(main); }
    $$(".k-mods .chip", root).forEach(c => c.setAttribute("aria-pressed", root._mods.has(c.dataset.m)));
    root.querySelector(".k-sel").value = main;
    const ms = root.querySelector(".k-mode");
    ms.value = [...ms.options].some(o => o.value === mode) ? mode : (mode && mode.startsWith("long:") ? "long:450" : "press");
    KEY_EDITOR.draw(root);
  },
  keys(root) {
    const k = root.querySelector(".k-sel").value; if (!k) return "";
    const toks = new Set(root._mods); toks.add(k);
    if (MODS.includes(k)) { const rest = [...toks].filter(t => t !== k); return [...MODS.filter(m => rest.includes(m)), k].join("+"); }
    return normKeys([...toks].join("+"));
  },
  mode(root) { return root.querySelector(".k-mode").value; },
  draw(root) {
    const k = KEY_EDITOR.keys(root);
    root.querySelector(".keycaps").innerHTML = k ? k.split("+").map(t => `<span class="keycap">${esc(fmtTok(t))}</span>`).join('<span class="plus">+</span>') : `<span class="muted">No key</span>`;
  },
};
let bindFor = null;
function openBind(ref) { bindFor = ref; fillBind(); openSheet("bindScrim"); }
function fillBind() {
  const ref = bindFor, d = actDef(ref), b = binding(ref);
  $("#bindTitle").textContent = b.name;
  $("#bindAction").textContent = d && d.act ? d.act : "Custom keys on this control";
  KEY_EDITOR.set($("#bindKeys"), b.keys, b.mode);
  $("#bindSrc").textContent = { custom: "Custom key saved on this deck", game: "From your Star Citizen keybinds",
    default: "Star Citizen default", cleared: "Unbound in your Star Citizen keybinds", none: "Star Citizen has no default key for this" }[b.src];
  $("#bindReset").disabled = b.src !== "custom" || !b.act;
  $("#bindNote").textContent = b.src === "none"
    ? `Pick a free key, then bind the same key to "${b.name}" in Star Citizen (Options › Keybindings). F13–F24 never clash with anything.`
    : "Match what you set in Star Citizen. Keys you change in the game's own keybinding menu are picked up automatically.";
}
async function saveBind() {
  const d = actDef(bindFor), keys = KEY_EDITOR.keys($("#bindKeys")), mode = KEY_EDITOR.mode($("#bindKeys"));
  if (!d || !d.act) return toast("Change custom keys in the layout editor.", "warn");
  if (S.demo) { S.custom[d.act] = { keys, mode }; store.set("demoCustom", S.custom); }
  else {
    const r = await command({ t: "bind", action: d.act, keys, mode });
    if (!r.ok) return toast(r.err === "offline" ? "Not connected, so the key wasn't saved." : `Couldn't save: ${r.err}`, "bad");
    S.custom[d.act] = { keys, mode };
  }
  renderAll();
  toast(`${d.name} now sends ${keys ? fmtKeys(keys) : "nothing"}.`);
  closeSheets();
}
async function resetBind() {
  const d = actDef(bindFor); if (!d || !d.act) return;
  if (S.demo) { delete S.custom[d.act]; store.set("demoCustom", S.custom); }
  else { const r = await command({ t: "bind", action: d.act, keys: null }); if (!r.ok) return toast("Not connected, so nothing changed.", "bad"); delete S.custom[d.act]; }
  renderAll(); fillBind(); toast("Back to the game's binding.");
}
async function testBind() {
  const root = $("#bindKeys"), keys = KEY_EDITOR.keys(root);
  if (!keys) return toast("Pick a key first.", "warn");
  const sp = spec(KEY_EDITOR.mode(root));
  const r = await command({ t: "pulse", keys, ms: sp.ms, repeat: sp.repeat || 1 });
  toast(r.ok ? `Sent ${fmtKeys(keys)}${S.demo ? " (demo)" : ""}.` : r.err === "focus" ? "Star Citizen isn't in front on your PC, so nothing was sent." : "Not sent: no link to your PC.", r.ok ? "" : "warn");
}
function openChooser(refs) {
  $("#chooseList").innerHTML = refs.map(r => { const b = binding(r);
    return `<button class="li" type="button" data-ref="${esc(r)}"><span class="grow"><b>${esc(b.name)}</b><span>${b.keys ? esc(fmtKeys(b.keys)) : "No key"}</span></span><span class="badge">CHANGE</span></button>`; }).join("");
  openSheet("chooseScrim");
}

/* =====================================================================================
   Sheets
   ===================================================================================== */
function openSheet(id) { $$(".scrim").forEach(s => { if (s.id !== "pinScrim" && s.id !== id) s.hidden = true; }); $("#" + id).hidden = false; }
function closeSheets() { $$(".scrim").forEach(s => { if (s.id !== "pinScrim") s.hidden = true; }); bindFor = null; }

function flip(el, on) { el.setAttribute("aria-checked", on); el.textContent = on ? "ON" : "OFF"; }
function fillSettings() {
  $("#demoInfo").hidden = !S.demo;
  $("#liveInfo").hidden = S.demo;
  $("#focusRow").hidden = S.demo;
  $("#repairBtn").hidden = S.demo;
  $("#setSub").textContent = S.demo ? "Demo deck" : S.authed ? `Companion ${S.version} on your PC` : "Not connected";
  if (!S.demo) {
    $("#linkKv").innerHTML = `<dt>Status</dt><dd>${S.authed ? "Connected" : "Not connected"}</dd>
      <dt>PC address</dt><dd>${esc(location.host)}</dd>
      <dt>Key input</dt><dd>${S.backend === "dry-run" ? "Dry run (keys are logged, not pressed)" : esc(S.backend || "—")}</dd>
      <dt>Round trip</dt><dd>${S.lat != null ? S.lat + " ms" : "—"}</dd>`;
    const am = S.am || {}, g = S.game || {};
    $("#amKv").innerHTML = (am.error ? `<dt>Keybinds</dt><dd>${esc(am.error)}. Using Star Citizen's default keys.</dd>`
      : `<dt>Keybinds</dt><dd>${esc(am.path || "—")}</dd><dt>Your rebinds</dt><dd>${am.count ?? 0} keyboard and mouse changes</dd>`)
      + `<dt>Game.log</dt><dd>${g.log ? esc(g.log) : "Not found yet. It appears after Star Citizen has run once."}</dd>`;
    if (S.settings.channel) $("#chanSel").value = S.settings.channel;
    flip($("#optFocus"), S.settings.require_focus !== false);
    const vj = S.vjoy || {};
    $("#vjoyKv").innerHTML = vj.ok
      ? `<dt>vJoy</dt><dd>Device ${vj.device}: ${vj.axes.length} axes (${esc(vj.axes.join(", ").toUpperCase())}), ${vj.buttons} buttons</dd>`
      : `<dt>vJoy</dt><dd>${esc(vj.error || "Not available")}. Sliders and the throttle step through keys instead.</dd>`;
    const ovOk = S.overlay && S.overlay.available && !S.overlayMode;
    $("#overlayBox").hidden = !ovOk;
    if (ovOk) {
      $("#monSel").innerHTML = (S.overlay.monitors || []).map(m => `<option value="${m.id}">Screen ${m.id}: ${m.w}×${m.h}${m.primary ? " (main)" : ""}</option>`).join("");
      const side = (S.overlay.monitors || []).filter(m => !m.primary).sort((a, b) => a.w * a.h - b.w * b.h)[0];
      if (side) $("#monSel").value = side.id;
    }
  }
  flip($("#optSound"), S.opt.sound);
  flip($("#optHaptic"), S.opt.haptic);
  flip($("#optFollow"), S.opt.follow);
  $("#skinGrid").innerHTML = [{ id: "", name: "Deck's own", sw: ["#2a3238", "#9fd8ff"] }, ...SKINS].map(s =>
    `<button class="skin" type="button" data-skin="${s.id}" aria-pressed="${S.opt.skin === s.id}"><i style="background:linear-gradient(90deg, ${s.sw[0]} 60%, ${s.sw[1]} 60%)"></i>${esc(s.name)}</button>`).join("");
}
function wireSettings() {
  $("#setBtn").addEventListener("click", () => { fillSettings(); openSheet("setScrim"); });
  $$("[data-close]").forEach(b => b.addEventListener("click", closeSheets));
  $$(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s && s.id !== "pinScrim") closeSheets(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
  const opt = (id, key, after) => $(id).addEventListener("click", () => { S.opt[key] = !S.opt[key]; store.set(key, S.opt[key]); fillSettings(); sound("click"); after && after(); });
  opt("#optSound", "sound"); opt("#optHaptic", "haptic"); opt("#optFollow", "follow");
  $("#skinGrid").addEventListener("click", e => { const b = e.target.closest(".skin"); if (!b) return; S.opt.skin = b.dataset.skin; store.set("skin", S.opt.skin); applySkin(); fillSettings(); });
  $("#optFocus").addEventListener("click", () => { const v = !(S.settings.require_focus !== false); S.settings.require_focus = v; wsSend({ t: "settings", require_focus: v }); fillSettings(); });
  $("#chanSel").addEventListener("change", e => wsSend({ t: "settings", channel: e.target.value }));
  $("#reloadBtn").addEventListener("click", async () => {
    const r = await command({ t: "reload" });
    toast(r.ok ? "Reloaded keybinds and Game.log from Star Citizen." : "Not connected.", r.ok ? "" : "bad");
    fillSettings();
  });
  $("#resetStates").addEventListener("click", () => { setStates({ ...STATE_DEFAULTS }); toast("All lights reset to a cold, landed ship."); });
  $("#fullBtn").addEventListener("click", () => {
    const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (req) Promise.resolve(req.call(d)).catch(() => toast("Full screen isn't available here. On iPad, use Share › Add to Home Screen instead.", "warn"));
    else toast("Full screen isn't available here. On iPad, use Share › Add to Home Screen instead.", "warn");
  });
  $("#repairBtn").addEventListener("click", () => { store.del("pin"); closeSheets(); openPin(); });
  $("#ovOpen").addEventListener("click", async () => {
    const r = await command({ t: "overlay_open", monitor: +$("#monSel").value });
    toast(r.ok ? "Opening the deck on that screen. Touches there won't pull focus from the game." : `Couldn't open the overlay: ${r.err}`, r.ok ? "" : "bad");
  });
  $("#ovClose").addEventListener("click", () => command({ t: "overlay_close" }));
  $("#keysBtn").addEventListener("click", () => setMode(S.mode === "keys" ? "play" : "keys"));
  $("#editBtn").addEventListener("click", () => S.mode === "edit" ? EDITOR.done() : EDITOR.start());
  $("#deckChip").addEventListener("click", () => { fillDeckSheet(); openSheet("deckScrim"); });
  $("#bindSave").addEventListener("click", saveBind);
  $("#bindReset").addEventListener("click", resetBind);
  $("#bindTest").addEventListener("click", testBind);
  $("#chooseList").addEventListener("click", e => { const b = e.target.closest("[data-ref]"); if (b) openBind(b.dataset.ref); });
}
function setMode(mode) {
  S.mode = mode;
  document.body.classList.toggle("binding", mode === "keys");
  document.body.classList.toggle("editing", mode === "edit");
  $("#keysBtn").setAttribute("aria-pressed", mode === "keys");
  $("#editBtn").setAttribute("aria-pressed", mode === "edit");
  $$(".sw.armed").forEach(el => el.classList.remove("armed"));
  if (mode === "keys") readout("Key mode: tap a control to change the key it sends.");
  else if (mode === "play") readout("Ready.");
}

/* =====================================================================================
   Deck picker
   ===================================================================================== */
function fillDeckSheet() {
  const g = S.game || {};
  $("#deckSub").textContent = g.ship ? `In ${g.ship}${g.shipinfo?.roles?.length ? " · " + g.shipinfo.roles.join(", ") : ""}` : "Pick the controls you want on this device.";
  $("#deckList").innerHTML = allDecks().map(d => `<button class="li${d.id === S.deckId ? " on" : ""}" type="button" data-deck="${esc(d.id)}">
      <span class="grow"><b>${esc(d.name)}</b><span>${esc(d.about || `${d.pages.length} pages`)}</span></span>
      <span class="badge">${d.builtin ? "BUILT-IN" : "YOURS"}</span></button>`).join("");
  const cur = getDeck(S.deckId);
  $("#deckDelete").hidden = !cur || cur.builtin;
}
function wireDeckSheet() {
  $("#deckList").addEventListener("click", e => {
    const b = e.target.closest("[data-deck]"); if (!b) return;
    useDeck(b.dataset.deck, "manual"); fillDeckSheet(); closeSheets();
    toast(`${currentDeck().name} deck${S.game?.ship ? `, remembered for ${S.game.ship}` : ""}.`);
  });
  $("#deckEdit").addEventListener("click", () => { closeSheets(); EDITOR.start(); });
  $("#deckDup").addEventListener("click", () => { const d = EDITOR.duplicate(getDeck(S.deckId)); persistDeck(d).then(() => { useDeck(d.id, "manual"); fillDeckSheet(); toast(`Made "${d.name}". Tap Edit layout to change it.`); }); });
  $("#deckShare").addEventListener("click", async () => {
    const code = await EDITOR.exportCode(getDeck(S.deckId));
    $("#shareCode").value = code; $("#shareTitle").textContent = `Share "${getDeck(S.deckId).name}"`;
    $("#shareMode").dataset.mode = "export"; $("#shareGo").textContent = "Copy code"; openSheet("shareScrim");
  });
  $("#deckImport").addEventListener("click", () => {
    $("#shareCode").value = ""; $("#shareTitle").textContent = "Import a deck";
    $("#shareMode").dataset.mode = "import"; $("#shareGo").textContent = "Import"; openSheet("shareScrim");
  });
  $("#shareGo").addEventListener("click", async () => {
    if ($("#shareMode").dataset.mode === "export") {
      const ta = $("#shareCode");
      try { await navigator.clipboard.writeText(ta.value); toast("Code copied. Paste it anywhere to share."); }
      catch { ta.focus(); ta.select(); toast("Select the code and copy it."); }
      return;
    }
    try {
      const d = await EDITOR.importCode($("#shareCode").value.trim());
      await persistDeck(d); useDeck(d.id, "manual"); closeSheets(); toast(`Imported "${d.name}".`);
    } catch (err) { toast(`That code didn't work: ${err.message}`, "bad"); }
  });
  $("#deckDelete").addEventListener("click", async () => {
    const d = getDeck(S.deckId); if (!d || d.builtin) return;
    if (!$("#deckDelete").dataset.armed) { $("#deckDelete").dataset.armed = "1"; $("#deckDelete").textContent = "Tap again to delete"; setTimeout(() => { delete $("#deckDelete").dataset.armed; $("#deckDelete").textContent = "Delete this deck"; }, 3000); return; }
    delete $("#deckDelete").dataset.armed; $("#deckDelete").textContent = "Delete this deck";
    if (S.demo) { S.userDecks = S.userDecks.filter(x => x.id !== d.id); saveUserDecks(); }
    else { const r = await command({ t: "deck_delete", deck_id: d.id }); if (!r.ok) return toast("Not connected, so nothing was deleted.", "bad"); S.userDecks = S.userDecks.filter(x => x.id !== d.id); }
    useDeck("standard", "auto"); fillDeckSheet(); toast(`Deleted "${d.name}".`);
  });
}
async function persistDeck(d) {
  const i = S.userDecks.findIndex(x => x.id === d.id);
  if (i >= 0) S.userDecks[i] = d; else S.userDecks.push(d);
  if (S.demo) { saveUserDecks(); return true; }
  const r = await command({ t: "deck_save", deck: d });
  if (!r.ok) { toast(r.err === "offline" ? "Not connected, so the deck wasn't saved on your PC." : `Couldn't save: ${r.err}`, "bad"); return false; }
  return true;
}

/* =====================================================================================
   Boot
   ===================================================================================== */
async function boot() {
  const m = location.hash.match(/pin=(\d{6})/);
  if (m) { store.set("pin", m[1]); history.replaceState(null, "", location.pathname + location.search); }
  if (S.overlayMode) { document.body.classList.add("overlay"); document.title = "SC Glass Overlay"; }
  KEY_EDITOR.mount($("#bindKeys"));
  buildPad(); wireSettings(); wireDeckSheet(); EDITOR.wire();
  let live = false;
  if (/^https?:$/.test(location.protocol)) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("api/info", { cache: "no-store", signal: ctl.signal });
      clearTimeout(to);
      live = r.ok && (await r.json()).app === "sc-glass";
    } catch {}
  }
  if (live) { S.live = true; renderDeck(); connect(); } else enterDemo();
  setInterval(() => renderWhere(it => it.k === "info" && it.src === "session"), 30000);
}
document.addEventListener("DOMContentLoaded", boot);
