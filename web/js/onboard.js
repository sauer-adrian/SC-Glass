"use strict";
/* =====================================================================================
   First-run welcome on the tablet: what this is, what you fly, a one-minute drill on real
   switches (nothing is sent to the game), where the tools are, and home-screen setup.
   Lore voice by default; Settings › Plain language drops the flavour.
   ===================================================================================== */
const L = (lore, plain) => (S.opt.plain ? plain : lore);
const DEVICE = (() => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { ios, ipad: /iPad/.test(ua) || (ios && !/iPhone|iPod/.test(ua)), android: /Android/.test(ua),
    touch: navigator.maxTouchPoints > 0,
    standalone: () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true };
})();
const DEVICE_NAME = DEVICE.ipad ? "iPad" : DEVICE.ios ? "iPhone" : DEVICE.android ? "tablet" : "screen";

const ONBOARD = {
  i: 0, steps: [], saved: null, drillCells: [], tasks: {},

  start(replay) {
    if (ONBOARD.el) ONBOARD.finish(true);
    if (S.mode !== "play") setMode("play");
    closeSheets();
    const el = document.createElement("div");
    el.className = "scrim ob"; el.id = "onboard";
    el.innerHTML = `<div class="sheet ob-card" role="dialog" aria-modal="true" aria-labelledby="obTitle"><div class="ob-dots"></div><div class="ob-body"></div></div>`;
    document.body.append(el);
    ONBOARD.el = el;
    ONBOARD.steps = ["welcome", "ship", "drill", "tools", "home", "done"]
      .filter(s => !(s === "home" && (DEVICE.standalone() || S.overlayMode)));
    ONBOARD.i = 0;
    ONBOARD.show();
  },

  show() {
    const id = ONBOARD.steps[ONBOARD.i];
    ONBOARD.el.querySelector(".ob-dots").innerHTML = ONBOARD.steps.map((_, j) =>
      `<i class="${j < ONBOARD.i ? "past" : j === ONBOARD.i ? "now" : ""}"></i>`).join("");
    const body = ONBOARD.el.querySelector(".ob-body");
    document.querySelector(".bar").classList.toggle("ob-front", id === "tools");
    $$(".ob-glow").forEach(x => x.classList.remove("ob-glow"));
    if (id !== "drill") ONBOARD.endDrill();
    body.innerHTML = ONBOARD.render[id]();
    body.querySelectorAll("[data-ob]").forEach(b => b.addEventListener("click", () => ONBOARD.act(b.dataset.ob, b)));
    if (ONBOARD.after[id]) ONBOARD.after[id](body);
    body.querySelector("h2")?.focus?.();
  },
  next() { sound("click"); NOSLEEP.on(); ONBOARD.i = Math.min(ONBOARD.steps.length - 1, ONBOARD.i + 1); ONBOARD.show(); },
  act(what, btn) {
    if (what === "next") return ONBOARD.next();
    if (what === "skip" || what === "finish") return ONBOARD.finish();
    if (what === "plain") { S.opt.plain = !S.opt.plain; store.set("plain", S.opt.plain); fillSettings(); return ONBOARD.show(); }
    if (what.startsWith("deck:")) {
      useDeck(what.slice(5), "auto");
      readout(`<b>${esc(currentDeck().name)}</b> deck loaded`);
      return ONBOARD.next();
    }
  },
  finish(silent) {
    ONBOARD.endDrill();
    document.querySelector(".bar").classList.remove("ob-front");
    $$(".ob-glow").forEach(x => x.classList.remove("ob-glow"));
    if (ONBOARD.el) ONBOARD.el.remove();
    ONBOARD.el = null;
    store.set("onboarded", true);
    NOSLEEP.on();
    if (!silent) readout(L("Deck commissioned. Tap anything to fly.", "Ready. Tap anything to use it."));
  },

  /* ---------- the drill: real controls, nothing sent ---------- */
  startDrill(host) {
    ONBOARD.saved = clone(S.states);
    S.training = true;
    Object.assign(S.states, { gear: "DOWN", lights: 1, mm: "SCM" });
    const page = { id: "__drill", name: "Drill", panels: [] };
    const pn = PANEL(L("Pre-flight drill", "Practice"), 4, [C("gear", "Gear", "gear", "gear"), G("eject", "Eject", "red"),
      C("lights", "Lights", "lights"), M("Travel", STEPS.travel, { tone: "blue" })]);
    const panel = buildPanel(page, pn, 0);
    host.append(panel);
    ONBOARD.drillCells = [...panel.querySelectorAll(".cell")];
    ONBOARD.drillCells.forEach(c => { const ctx = ITEMS.get(c); if (ctx) (CONTROLS[ctx.item.k] || CONTROLS.pulse).render(ctx.item, c); });
    ONBOARD.tasks = {};
    let tappedLights = false;
    S.onEvent = (type, a, b) => {
      if (type === "state" && a === "gear" && b === "UP") ONBOARD.done("gear");
      if (type === "fire" && a === "eject") ONBOARD.done("eject");
      if (type === "fire" && a === "lights") { tappedLights = true; ONBOARD.hint("lights", L("That one sent the key. Hold the switch for a second instead.", "That sent the key. Hold it for a second instead.")); }
      if (type === "resync" && a === "lights") ONBOARD.done("lights");
      if (type === "macro") ONBOARD.done("travel");
      void tappedLights;
    };
  },
  endDrill() {
    if (!S.training) return;
    S.training = false; S.onEvent = null;
    ONBOARD.drillCells.forEach(c => ITEMS.delete(c));
    ONBOARD.drillCells = [];
    if (ONBOARD.saved) { S.states = ONBOARD.saved; ONBOARD.saved = null; }
    renderAll();
  },
  done(task) {
    if (ONBOARD.tasks[task]) return;
    ONBOARD.tasks[task] = true;
    const li = ONBOARD.el && ONBOARD.el.querySelector(`[data-task="${task}"]`);
    if (li) { li.classList.add("ok"); li.querySelector(".hint").textContent = ""; }
    sound("on");
    if (["gear", "eject", "lights", "travel"].every(t => ONBOARD.tasks[t])) {
      const fin = ONBOARD.el.querySelector(".ob-drill-done");
      if (fin) fin.hidden = false;
      const nb = ONBOARD.el.querySelector('[data-ob="next"]');
      if (nb) { nb.textContent = "Next"; nb.classList.add("primary"); }
    }
  },
  hint(task, text) {
    const li = ONBOARD.el && ONBOARD.el.querySelector(`[data-task="${task}"] .hint`);
    if (li && !ONBOARD.tasks[task]) li.textContent = text;
  },

  render: {
    welcome() {
      const live = !S.demo;
      const title = live
        ? L(`Display linked. Welcome aboard, Citizen.`, `Your ${DEVICE_NAME} is connected${S.host ? ` to ${S.host}` : ""}.`)
        : L("Simulator mode. Welcome aboard, Citizen.", "This is a demo of SC Glass.");
      const body = live
        ? "This deck flips switches in Star Citizen for you: tap a control here and your PC presses the key."
        : "Everything works here, but nothing reaches a game until SC Glass runs on your PC.";
      return `<div class="ob-eyebrow">${L(live ? `Commissioning · ${esc(S.host || "your rig")}` : "Glass cockpit retrofit · SEY 2956", "Welcome")}</div>
        <h2 id="obTitle" tabindex="-1">${esc(title)}</h2>
        <p>${body} A one-minute drill covers the four things worth knowing.</p>
        <div class="ob-actions"><button class="btn primary" type="button" data-ob="next">Start the drill</button>
          <button class="btn" type="button" data-ob="skip">Skip, I've flown one before</button></div>
        <button class="ob-link" type="button" data-ob="plain">${S.opt.plain ? "Bring back the flavour text" : "Prefer plain language? Turn off the flavour text"}</button>`;
    },
    ship() {
      const g = S.game;
      if (g && g.ship && !g.example) {
        return `<div class="ob-eyebrow">${L("Hangar", "Your ship")}</div>
          <h2 id="obTitle" tabindex="-1">${esc(L(`Your ${g.ship} is on the pad.`, `You're in a ${g.ship}.`))}</h2>
          <p>The <b>${esc(currentDeck().name)}</b> deck is loaded for it. When you board a different kind of ship, the deck changes with you.</p>
          <div class="ob-actions"><button class="btn primary" type="button" data-ob="next">Continue</button></div>`;
      }
      const opts = [["fighter", "Fighter", L("Dogfights, bounties, escort work.", "Combat")], ["mining", "Mining", L("Rocks, lasers and refinery runs.", "Mining")],
        ["salvage", "Salvage", L("Hull scraping and recycling.", "Salvage")], ["hauler", "Hauling", L("Cargo runs between stations.", "Trading and cargo")],
        ["standard", "A bit of everything", L("Every control on six pages.", "All controls")]];
      return `<div class="ob-eyebrow">${L("Flight assignment", "Pick a layout")}</div>
        <h2 id="obTitle" tabindex="-1">What do you fly most?</h2>
        <p>This picks your starting layout. Once SC Glass sees you board a ship in the game, it switches by itself.</p>
        <div class="ob-ships">${opts.map(([id, name, sub]) => `<button class="li" type="button" data-ob="deck:${id}"><span class="grow"><b>${name}</b><span>${esc(sub)}</span></span></button>`).join("")}</div>`;
    },
    drill() {
      const t = (id, text) => `<li data-task="${id}"><i></i><div>${text}<div class="hint"></div></div></li>`;
      return `<div class="ob-eyebrow">${L("Pre-flight drill", "Practice")}</div>
        <h2 id="obTitle" tabindex="-1">${L("Four checks before you launch", "Try these four things")}</h2>
        <p class="muted">These switches work, but nothing goes to the game during the drill.</p>
        <div class="ob-drill"></div>
        <ol class="ob-tasks">
          ${t("gear", "Raise the landing gear.")}
          ${t("eject", "Eject is guarded. Tap once to lift the guard, then tap again to fire.")}
          ${t("lights", "The Lights lamp says ON, but say your lights are off. Hold the switch for a second: the lamp flips and no key is sent.")}
          ${t("travel", "Tap Travel. A sequence presses several switches in order and skips any that are already done.")}
        </ol>
        <p class="ob-drill-done" hidden>${L("Drill complete. You fly like you've done this before.", "Done. That's everything you need.")}</p>
        <div class="ob-actions"><button class="btn" type="button" data-ob="next">Skip the drill</button></div>`;
    },
    tools() {
      return `<div class="ob-eyebrow">${L("Your cockpit", "The top bar")}</div>
        <h2 id="obTitle" tabindex="-1">Four tools, lit up above</h2>
        <ul class="ob-tools">
          <li><b>Deck name</b><span>Switch layouts. Mining ships get the Mining deck on their own.</span></li>
          <li><b>KEYS</b><span>See which key any control sends, or change it. Missing keys can be set up for you.</span></li>
          <li><b>EDIT</b><span>Move, add or change controls. Saving updates every paired screen.</span></li>
          <li><b>Settings</b><span>Sounds, skins, plain language, and this tour again.</span></li>
        </ul>
        <div class="ob-actions"><button class="btn primary" type="button" data-ob="next">Next</button></div>`;
    },
    home() {
      const how = DEVICE.ios
        ? `In Safari, tap <b>Share</b> <svg class="ob-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg>, then <b>Add to Home Screen</b>, then <b>Add</b>.`
        : DEVICE.android ? "In Chrome, tap <b>⋮</b> at the top right, then <b>Add to Home screen</b>."
        : "Press <b>F11</b> for full screen. The deck is made for touch, so a tablet or phone is the best seat.";
      return `<div class="ob-eyebrow">${L("Mounting", "Home screen")}</div>
        <h2 id="obTitle" tabindex="-1">${DEVICE.touch ? `Pin the deck to your ${DEVICE_NAME}` : "Go full screen"}</h2>
        <p>${how}</p>
        <p class="muted">${DEVICE.touch ? "It then opens full screen, like an app, and reconnects to your PC by itself. " : ""}The screen stays on while the deck is open.</p>
        <div class="ob-actions"><button class="btn primary" type="button" data-ob="next">Next</button></div>`;
    },
    done() {
      return `<div class="ob-eyebrow">${L("Commissioning complete", "All set")}</div>
        <h2 id="obTitle" tabindex="-1">${L("Systems nominal. Clear skies, Citizen. o7", "You're ready.")}</h2>
        <p>Switch lights follow the game when you board, restart or respawn. If one ever looks wrong, hold it for a second.</p>
        <div class="ob-actions"><button class="btn primary" type="button" data-ob="finish">${L("Start flying", "Start")}</button></div>`;
    },
  },
  after: {
    drill(body) { ONBOARD.startDrill(body.querySelector(".ob-drill")); },
    tools() { ["#deckChip", "#keysBtn", "#editBtn", "#setBtn"].forEach(s => $(s).classList.add("ob-glow")); },
  },
};
