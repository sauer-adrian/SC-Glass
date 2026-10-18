"use strict";
/* =====================================================================================
   Layout editor (Forge-style): pages, panels and controls, undo/redo, share codes.
   Built-in decks are never changed; the first edit makes your own copy.
   ===================================================================================== */
const EDIT = { deck: null, undo: [], redo: [], dirty: false, isNew: false, ctx: null, step: null, pickCb: null };
const STATE_KEYS = () => [...new Set([...Object.keys(STATE_DEFAULTS), ...Object.keys(S.states), "op"])].sort();
const SHIP_ROLES = ["mining", "salvage", "cargo", "military", "bomber", "exploration", "medical", "refuel", "repair", "racing", "passenger", "scanning", "industrial", "ground_vehicle"];

function slug(s) { return String(s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "deck"; }
function uniqueDeckId(name) { let id; do id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`; while (getDeck(id)); return id; }
function refName(ref) { if (!ref) return "Nothing"; const b = pick(ref); return `${b.name}${b.keys ? " · " + fmtKeys(b.keys) : " · no key"}`; }
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

const EDITOR = {
  start() {
    const base = currentDeck();
    EDIT.isNew = !!base.builtin;
    EDIT.deck = base.builtin ? EDITOR.duplicate(base) : clone(base);
    EDIT.undo = []; EDIT.redo = []; EDIT.dirty = EDIT.isNew;
    setMode("edit");
    $("#editMsg").textContent = base.builtin
      ? `Editing your copy of ${base.name}. Built-in decks stay as they are.`
      : `Editing ${base.name}. Tap any control to change it.`;
    renderDeck(); EDITOR.syncBar();
    readout("Edit mode: tap a control to change it, or use + Add.");
  },
  async done() {
    if (EDIT.dirty) {
      const ok = await persistDeck(EDIT.deck);
      if (!ok) return;
      S.deckId = EDIT.deck.id; store.set("deck", S.deckId);
      toast(`Saved "${EDIT.deck.name}"${S.demo ? " on this device" : ". Every paired device has it now"}.`);
    }
    EDIT.deck = null; setMode("play"); renderDeck();
  },
  discard() {
    if (EDIT.dirty && !$("#edDiscard").dataset.armed) {
      $("#edDiscard").dataset.armed = "1"; $("#edDiscard").textContent = "Tap again to discard";
      setTimeout(() => { delete $("#edDiscard").dataset.armed; $("#edDiscard").textContent = "Discard"; }, 3000);
      return;
    }
    delete $("#edDiscard").dataset.armed; $("#edDiscard").textContent = "Discard";
    EDIT.deck = null; setMode("play"); renderDeck(); toast("Changes discarded.");
  },
  mutate(fn, keepSheet) {
    EDIT.undo.push(JSON.stringify(EDIT.deck)); if (EDIT.undo.length > 80) EDIT.undo.shift();
    EDIT.redo = [];
    fn();
    EDIT.dirty = true;
    renderDeck(); EDITOR.syncBar();
    if (!keepSheet) return;
  },
  undoRedo(dir) {
    const from = dir < 0 ? EDIT.undo : EDIT.redo, to = dir < 0 ? EDIT.redo : EDIT.undo;
    if (!from.length) return;
    to.push(JSON.stringify(EDIT.deck));
    EDIT.deck = JSON.parse(from.pop()); EDIT.dirty = true;
    closeSheets(); renderDeck(); EDITOR.syncBar();
  },
  syncBar() {
    $("#edUndo").disabled = !EDIT.undo.length; $("#edRedo").disabled = !EDIT.redo.length;
    $("#edDone").textContent = EDIT.dirty ? "Save" : "Done";
  },
  duplicate(deck) {
    const d = clone(deck);
    d.name = deck.builtin ? `My ${deck.name}` : `${deck.name} copy`;
    d.id = uniqueDeckId(d.name);
    d.forked_from = deck.builtin ? deck.id : (deck.forked_from || "");
    delete d.builtin;
    return d;
  },

  /* ---------- panels and pages ---------- */
  addPanel(page) {
    EDITOR.mutate(() => { const p = EDIT.deck.pages.find(x => x.id === page.id); p.panels.push({ t: "New panel", c: 3, items: [] }); });
  },
  panelTool(page, pn, tool) {
    const p = EDIT.deck.pages.find(x => x.id === page.id), i = p.panels.indexOf(pn);
    if (i < 0) return;
    if (tool === "edit") return EDITOR.openPanel(p, pn);
    EDITOR.mutate(() => {
      if (tool === "left" && i > 0) [p.panels[i - 1], p.panels[i]] = [p.panels[i], p.panels[i - 1]];
      if (tool === "right" && i < p.panels.length - 1) [p.panels[i + 1], p.panels[i]] = [p.panels[i], p.panels[i + 1]];
      if (tool === "narrow") pn.c = Math.max(1, (pn.c || 3) - 1);
      if (tool === "wide") pn.c = Math.min(12, (pn.c || 3) + 1);
    });
  },
  openPanel(page, pn) {
    EDIT.ctx = { page, panel: pn };
    $("#panelTitle").value = pn.t || "";
    flip($("#panelDanger"), !!pn.danger);
    openSheet("panelScrim");
  },
  addItem(page, pn) {
    const item = { k: "pulse", lg: "New button", a: "" };
    EDITOR.mutate(() => pn.items.push(item));
    const cell = [...ITEMS].find(([, c]) => c.item === item)?.[0];
    EDITOR.openItem({ item, panel: pn, page }, cell);
  },

  /* ---------- item sheet ---------- */
  openItem(ctx, cell) {
    EDIT.ctx = ctx;
    $$(".cell.picked").forEach(c => c.classList.remove("picked"));
    if (cell) cell.classList.add("picked");
    EDITOR.fillItem();
    openSheet("itemScrim");
  },
  fillItem() {
    const { item, panel } = EDIT.ctx;
    $("#itemTitle").textContent = item.lg || KINDS[item.k] || "Control";
    $("#itemSub").textContent = `${KINDS[item.k] || item.k} in ${panel.t || "panel"}`;
    const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label ?? v)}</option>`;
    const actBtn = (f, ref, label) => `<div class="field"><span class="flabel">${label}</span><button class="li" type="button" data-pick="${f}"><span class="grow"><b>${esc(ref ? pick(ref).name : "Choose an action")}</b><span>${ref ? esc(refName(ref).split(" · ")[1] || "") : "Tap to pick from the Star Citizen catalog"}</span></span><span class="badge">CHANGE</span></button></div>`;
    const text = (f, v, label, ph = "") => `<div class="field"><label for="f_${f}">${label}</label><input type="text" id="f_${f}" data-f="${f}" value="${esc(v ?? "")}" placeholder="${esc(ph)}"></div>`;
    const num = (f, v, label, min, max) => `<div class="field"><label for="f_${f}">${label}</label><input type="number" id="f_${f}" data-f="${f}" data-num="1" min="${min}" max="${max}" value="${esc(v ?? "")}"></div>`;
    const sel = (f, v, label, options) => `<div class="field"><label for="f_${f}">${label}</label><select id="f_${f}" data-f="${f}">${options.map(([val, l]) => opt(val, v, l)).join("")}</select></div>`;
    const tones = [["", "Standard"], ["red", "Red (danger)"], ["amber", "Amber (caution)"], ["blue", "Blue (travel)"]];
    let h = `<div class="fgrid">${sel("k", item.k, "Kind", Object.entries(KINDS))}${text("lg", item.lg, "Label")}
      ${sel("w", item.w || 1, "Width", Array.from({ length: Math.max(1, panel.c || 1) }, (_, i) => [i + 1, `${i + 1} column${i ? "s" : ""}`]))}
      ${sel("h", item.h || 1, "Height", [1, 2, 3, 4].map(n => [n, `${n} row${n > 1 ? "s" : ""}`]))}</div>`;
    const k = item.k;
    if (["pulse", "hold", "guard", "cycle", "sel"].includes(k)) h += actBtn("a", Array.isArray(item.a) ? item.a[0] : item.a, "Action");
    if (["pulse", "hold", "guard", "macro", "cycle", "sel"].includes(k)) h += sel("tone", item.tone || "", "Colour", tones);
    if (k === "cycle") h += `<div class="fgrid">${sel("s", item.s || "", "Light", [["", "Choose…"], ...STATE_KEYS().map(x => [x, x])])}${sel("lamp", item.lamp || "onoff", "Light style", Object.entries(LAMP_NAMES))}</div>`;
    if (k === "sel") h += `<div class="fgrid">${text("g", item.g || "op", "Group light")}${text("val", item.val, "Lights up when group is", "MINE")}${text("back", item.back, "Tap again returns to", "GUNS")}</div>`;
    if (k === "rocker") h += actBtn("dn", item.dn, "Left / down half") + actBtn("up", item.up, "Right / up half") +
      `<div class="fgrid">${text("l1", (item.labels || ["−", "+"])[0], "Left label")}${text("l2", (item.labels || ["−", "+"])[1], "Right label")}</div>`;
    if (k === "slider") h += actBtn("dn", item.dn, "One step down") + actBtn("up", item.up, "One step up") +
      `<div class="fgrid">${sel("s", item.s || "", "Light", [["", "Choose…"], ...STATE_KEYS().map(x => [x, x])])}${num("max", item.max || 4, "Pips", 2, 12)}${sel("tone", item.tone || "", "Colour", tones)}</div>`;
    if (k === "dial") h += actBtn("dn", item.dn, "Turn left") + actBtn("up", item.up, "Turn right") + num("detent", item.detent || 30, "Degrees per step", 10, 90);
    if (k === "lever") h += `<p class="muted">With vJoy installed the lever drives a real joystick axis. Without it, moving it presses the step keys below.</p>
      <div class="fgrid">${sel("axis", item.axis || "z", "vJoy axis", ["x", "y", "z", "rx", "ry", "rz", "sl0", "sl1"].map(a => [a, a.toUpperCase()]))}
      ${sel("spring", item.spring || "", "On release", [["", "Stays put"], ["center", "Springs to middle"], ["zero", "Springs to bottom"]])}
      ${num("steps", item.steps || 10, "Steps without vJoy", 2, 40)}${text("s", item.s || "thr_lever", "Light")}</div>` +
      actBtn("dn", item.dn, "Step down key") + actBtn("up", item.up, "Step up key");
    if (k === "pad") h += num("sens", item.sens || 1.6, "Sensitivity", 0.2, 8);
    if (k === "info") h += sel("src", item.src || "ship", "Shows", [["ship", "Current ship"], ["location", "Location"], ["session", "Session"], ["feed", "Game log"], ["market", "Market prices"]]) +
      (item.src === "market" ? text("commodity", item.commodity, "Starting commodity", "Laranite") : "");
    if (k === "selector") {
      h += text("g", item.g || "op", "Group light");
      h += `<h3>Positions</h3><div class="list">${(item.opts || []).map((o, i) => `<div class="step"><div><input type="text" data-opt="${i}" data-of="lg" value="${esc(o.lg || "")}" placeholder="Label" style="margin-bottom:6px">
          <input type="text" data-opt="${i}" data-of="val" value="${esc(o.val || "")}" placeholder="Light value" style="margin-bottom:6px">
          <button class="li" type="button" data-pickopt="${i}"><span class="grow"><b>${esc(o.a ? pick(o.a).name : "Choose an action")}</b><span>${o.a ? esc(refName(o.a).split(" · ")[1] || "") : ""}</span></span></button></div>
          <div class="ops"><button type="button" data-optdel="${i}" aria-label="Remove position">✕</button></div></div>`).join("")}</div>
        <div class="row"><button class="btn small" type="button" data-optadd="1">+ Add position</button></div>`;
    }
    if (k === "macro") {
      h += `<h3>Steps</h3><p class="muted">Steps run in order on your PC. Conditions use the switch lights, so a step is skipped when it's already done.</p><div class="list">${(item.steps || []).map((s, i) => `<div class="step"><div>${esc(EDITOR.stepText(s))}</div>
          <div class="ops"><button type="button" data-st="up" data-i="${i}" aria-label="Move step up">▲</button><button type="button" data-st="down" data-i="${i}" aria-label="Move step down">▼</button><button type="button" data-st="edit" data-i="${i}" aria-label="Edit step">✎</button><button type="button" data-st="del" data-i="${i}" aria-label="Remove step">✕</button></div></div>`).join("") || '<p class="muted">No steps yet.</p>'}</div>
        <div class="row"><button class="btn small" type="button" data-st="add">+ Add action</button><button class="btn small" type="button" data-st="wait">+ Add pause</button></div>`;
    }
    $("#itemForm").innerHTML = h;
    const pageObj = EDIT.ctx.page, panels = pageObj.panels;
    $("#itemMoveTo").innerHTML = panels.map((p, i) => opt(i, panels.indexOf(panel), p.t || `Panel ${i + 1}`)).join("");
  },
  stepText(s) {
    if (s.wait !== undefined) return `Pause ${s.wait} ms`;
    let t = s.a ? pick(s.a).name : "Nothing";
    if (s.if) t += " · only if " + Object.entries(s.if).map(([k, v]) => v && typeof v === "object" ? `${k} isn't ${v.ne}` : `${k} is ${v}`).join(", ");
    if (s.set) t += " · then " + Object.entries(s.set).map(([k, v]) => `${k} → ${v}`).join(", ");
    if (s.after) t += ` · wait ${s.after} ms`;
    if (s.ms) t += ` · hold ${s.ms} ms`;
    return t;
  },
  setField(f, raw, isNum) {
    const { item } = EDIT.ctx;
    let v = isNum ? +raw : raw;
    EDITOR.mutate(() => {
      if (f === "w" || f === "h") { v = +v; if (v > 1) item[f] = v; else delete item[f]; }
      else if (f === "k") EDITOR.convert(item, v);
      else if (f === "l1" || f === "l2") { item.labels = item.labels || ["−", "+"]; item.labels[f === "l1" ? 0 : 1] = v; }
      else if (v === "" || v === null) delete item[f];
      else item[f] = v;
    });
    EDITOR.fillItem();
  },
  convert(item, k) {
    const a = item.a || item.dn || item.up || "";
    for (const key of ["a", "s", "lamp", "g", "val", "back", "dn", "up", "labels", "steps", "opts", "max", "axis", "spring", "sens", "src", "detent", "sets"]) delete item[key];
    item.k = k;
    if (["pulse", "hold", "guard"].includes(k)) item.a = a;
    if (k === "cycle") { item.a = a; item.s = typeof a === "string" && a && !a.startsWith("keys:") ? a : "custom"; item.lamp = "onoff"; }
    if (k === "sel") { item.a = a; item.g = "op"; item.val = "MODE"; }
    if (k === "rocker") { item.dn = a; item.up = ""; }
    if (k === "slider") { item.dn = ""; item.up = ""; item.s = "custom"; item.max = 4; item.h = 2; }
    if (k === "dial") { item.dn = ""; item.up = ""; }
    if (k === "lever") { item.axis = "z"; item.s = "thr_lever"; item.dn = "spddn"; item.up = "spdup"; item.steps = 10; item.h = 2; }
    if (k === "pad") { item.sens = 1.6; item.w = 2; item.h = 2; }
    if (k === "selector") { item.g = "op"; item.opts = [{ val: "A", lg: "A", a: "" }, { val: "B", lg: "B", a: "" }]; item.w = 2; item.h = 2; }
    if (k === "macro") item.steps = a ? [{ a }] : [];
    if (k === "info") { item.src = "ship"; item.w = 3; item.h = 2; }
  },
  itemOp(op) {
    const { item, panel, page } = EDIT.ctx, i = panel.items.indexOf(item);
    if (op === "delete") { EDITOR.mutate(() => panel.items.splice(i, 1)); closeSheets(); return; }
    if (op === "dup") { const copy = clone(item); EDITOR.mutate(() => panel.items.splice(i + 1, 0, copy)); EDIT.ctx = { ...EDIT.ctx, item: copy }; EDITOR.fillItem(); return; }
    if (op === "left" && i > 0) EDITOR.mutate(() => { [panel.items[i - 1], panel.items[i]] = [panel.items[i], panel.items[i - 1]]; });
    if (op === "right" && i < panel.items.length - 1) EDITOR.mutate(() => { [panel.items[i + 1], panel.items[i]] = [panel.items[i], panel.items[i + 1]]; });
    if (op === "move") {
      const to = page.panels[+$("#itemMoveTo").value];
      if (to && to !== panel) { EDITOR.mutate(() => { panel.items.splice(i, 1); to.items.push(item); }); EDIT.ctx = { ...EDIT.ctx, panel: to }; EDITOR.fillItem(); }
    }
  },

  /* ---------- action picker ---------- */
  openPicker(current, cb) {
    EDIT.pickCb = cb;
    $("#pickSearch").value = "";
    const raw = typeof current === "string" && current.startsWith("keys:") ? current.slice(5).split("|") : null;
    KEY_EDITOR.set($("#pickKeys"), raw ? raw[0] : "", raw ? raw[1] : "press");
    EDITOR.drawPicker(current);
    openSheet("pickScrim");
    $("#itemScrim").hidden = false;
    $("#pickScrim").style.zIndex = 31;
  },
  drawPicker(current) {
    const q = $("#pickSearch").value.trim().toLowerCase();
    let h = "";
    for (const [cat, acts] of Object.entries(CATALOG)) {
      const rows = Object.entries(acts).filter(([id, d]) => !q || d[3].toLowerCase().includes(q) || d[0].toLowerCase().includes(q) || cat.toLowerCase().includes(q));
      if (!rows.length) continue;
      h += `<h5>${esc(cat)}</h5>` + rows.map(([id]) => { const b = binding(id);
        return `<button class="act${id === current ? " on" : ""}" type="button" data-id="${id}"><span>${esc(b.name)}</span><code>${b.keys ? esc(fmtKeys(b.keys)) : "no key"}</code></button>`; }).join("");
    }
    $("#pickList").innerHTML = h || '<p class="muted">Nothing matches. Use custom keys above.</p>';
  },
  picked(ref) {
    const cb = EDIT.pickCb; EDIT.pickCb = null;
    $("#pickScrim").hidden = true; $("#pickScrim").style.zIndex = "";
    if (cb) cb(ref);
  },

  /* ---------- macro step editor ---------- */
  openStep(i) {
    const { item } = EDIT.ctx;
    const s = item.steps[i];
    EDIT.step = { i, draft: clone(s) };
    EDITOR.fillStep();
    openSheet("stepScrim"); $("#itemScrim").hidden = false; $("#stepScrim").style.zIndex = 31;
  },
  fillStep() {
    const d = EDIT.step.draft;
    const keys = STATE_KEYS();
    const ifKey = d.if ? Object.keys(d.if)[0] : "", ifVal = ifKey ? d.if[ifKey] : "";
    const neg = ifVal && typeof ifVal === "object";
    const setKey = d.set ? Object.keys(d.set)[0] : "", setVal = setKey ? d.set[setKey] : "";
    $("#stepAct").innerHTML = `<span class="grow"><b>${esc(d.a ? pick(d.a).name : "Choose an action")}</b><span>${d.a ? esc(refName(d.a).split(" · ")[1] || "") : ""}</span></span><span class="badge">CHANGE</span>`;
    $("#stepIfKey").innerHTML = `<option value="">Always</option>` + keys.map(k => `<option${k === ifKey ? " selected" : ""}>${k}</option>`).join("");
    $("#stepIfOp").value = neg ? "ne" : "eq";
    $("#stepIfVal").value = neg ? ifVal.ne : (ifVal ?? "");
    $("#stepSetKey").innerHTML = `<option value="">Nothing</option>` + keys.map(k => `<option${k === setKey ? " selected" : ""}>${k}</option>`).join("");
    $("#stepSetVal").value = setVal ?? "";
    $("#stepAfter").value = d.after || "";
    $("#stepMs").value = d.ms || "";
  },
  saveStep() {
    const d = EDIT.step.draft;
    const coerce = v => v === "" ? "" : (/^-?\d+$/.test(v) ? +v : v);
    const ik = $("#stepIfKey").value, sk = $("#stepSetKey").value;
    if (ik) d.if = { [ik]: $("#stepIfOp").value === "ne" ? { ne: coerce($("#stepIfVal").value) } : coerce($("#stepIfVal").value) }; else delete d.if;
    if (sk) d.set = { [sk]: coerce($("#stepSetVal").value) }; else delete d.set;
    const after = +$("#stepAfter").value, ms = +$("#stepMs").value;
    if (after > 0) d.after = after; else delete d.after;
    if (ms > 0) d.ms = ms; else delete d.ms;
    const { item } = EDIT.ctx, i = EDIT.step.i;
    EDITOR.mutate(() => { item.steps[i] = d; });
    $("#stepScrim").hidden = true; $("#stepScrim").style.zIndex = "";
    EDITOR.fillItem();
  },

  /* ---------- pages & deck properties ---------- */
  openPages() {
    const pages = EDIT.deck.pages;
    $("#pageList").innerHTML = pages.map((p, i) => `<div class="step"><input type="text" data-pg="${i}" value="${esc(p.name)}" aria-label="Page name">
      <div class="ops"><button type="button" data-pgop="up" data-i="${i}" aria-label="Move page earlier">▲</button><button type="button" data-pgop="down" data-i="${i}" aria-label="Move page later">▼</button><button type="button" data-pgop="del" data-i="${i}" aria-label="Delete page">✕</button></div></div>`).join("");
    openSheet("pageScrim");
  },
  openDeckProps() {
    const d = EDIT.deck;
    $("#dpName").value = d.name; $("#dpAbout").value = d.about || "";
    $("#dpMatch").value = (d.match || []).join(", ");
    $("#dpRoles").innerHTML = SHIP_ROLES.map(r => `<button class="chip" type="button" data-role="${r}" aria-pressed="${(d.roles || []).includes(r)}">${r.replace("_", " ")}</button>`).join("");
    $("#dpSkins").innerHTML = SKINS.map(s => `<button class="skin" type="button" data-skin="${s.id}" aria-pressed="${(d.skin || "gunmetal") === s.id}"><i style="background:linear-gradient(90deg, ${s.sw[0]} 60%, ${s.sw[1]} 60%)"></i>${esc(s.name)}</button>`).join("");
    openSheet("deckPropScrim");
  },

  /* ---------- share codes ---------- */
  async exportCode(deck) {
    const d = clone(deck); delete d.builtin;
    const json = JSON.stringify(d);
    try {
      const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
      return "SCG1." + b64url(buf);
    } catch { return "SCG0." + b64url(new TextEncoder().encode(json)); }
  },
  async importCode(code) {
    const m = code.replace(/\s+/g, "").match(/^SCG([01])\.([A-Za-z0-9_-]+)$/);
    if (!m) throw new Error("it should start with SCG1.");
    let json;
    try {
      const bytes = unb64url(m[2]);
      json = m[1] === "1" ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text() : new TextDecoder().decode(bytes);
    } catch { throw new Error("it's incomplete or damaged"); }
    const d = JSON.parse(json);
    if (!d || !Array.isArray(d.pages) || !d.pages.length) throw new Error("it has no pages");
    d.name = String(d.name || "Imported deck").slice(0, 60);
    if (allDecks().some(x => x.name === d.name)) d.name = `${d.name} (imported)`;
    d.id = getDeck(d.id) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(d.id || "") ? uniqueDeckId(d.name) : d.id;
    delete d.builtin;
    return d;
  },

  wire() {
    $("#edUndo").addEventListener("click", () => EDITOR.undoRedo(-1));
    $("#edRedo").addEventListener("click", () => EDITOR.undoRedo(1));
    $("#edDone").addEventListener("click", () => EDITOR.done());
    $("#edDiscard").addEventListener("click", () => EDITOR.discard());
    $("#edPages").addEventListener("click", () => EDITOR.openPages());
    $("#edDeck").addEventListener("click", () => EDITOR.openDeckProps());
    // item sheet
    $("#itemForm").addEventListener("change", e => {
      const t = e.target;
      if (t.dataset.f) return EDITOR.setField(t.dataset.f, t.value, !!t.dataset.num);
      if (t.dataset.opt !== undefined) { const o = EDIT.ctx.item.opts[+t.dataset.opt]; EDITOR.mutate(() => { o[t.dataset.of] = t.value; }); }
    });
    $("#itemForm").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const { item } = EDIT.ctx;
      if (b.dataset.pick) {
        const f = b.dataset.pick;
        return EDITOR.openPicker(Array.isArray(item[f]) ? item[f][0] : item[f], ref => {
          EDITOR.mutate(() => { item[f] = ref; if (item.k === "cycle" && (!item.s || item.s === "custom") && !ref.startsWith("keys:")) item.s = ref; });
          if (!item.lg || item.lg === "New button") EDITOR.mutate(() => { item.lg = pick(ref).name; });
          EDITOR.fillItem();
        });
      }
      if (b.dataset.pickopt !== undefined) {
        const o = item.opts[+b.dataset.pickopt];
        return EDITOR.openPicker(o.a, ref => { EDITOR.mutate(() => { o.a = ref; }); EDITOR.fillItem(); });
      }
      if (b.dataset.optadd) { EDITOR.mutate(() => item.opts.push({ val: `P${item.opts.length + 1}`, lg: `P${item.opts.length + 1}`, a: "" })); return EDITOR.fillItem(); }
      if (b.dataset.optdel !== undefined) { EDITOR.mutate(() => item.opts.splice(+b.dataset.optdel, 1)); return EDITOR.fillItem(); }
      if (b.dataset.st) {
        const i = +b.dataset.i, st = item.steps;
        if (b.dataset.st === "add") return EDITOR.openPicker("", ref => { EDITOR.mutate(() => st.push({ a: ref })); EDITOR.fillItem(); });
        if (b.dataset.st === "wait") { EDITOR.mutate(() => st.push({ wait: 500 })); return EDITOR.fillItem(); }
        if (b.dataset.st === "del") { EDITOR.mutate(() => st.splice(i, 1)); return EDITOR.fillItem(); }
        if (b.dataset.st === "up" && i > 0) { EDITOR.mutate(() => { [st[i - 1], st[i]] = [st[i], st[i - 1]]; }); return EDITOR.fillItem(); }
        if (b.dataset.st === "down" && i < st.length - 1) { EDITOR.mutate(() => { [st[i + 1], st[i]] = [st[i], st[i + 1]]; }); return EDITOR.fillItem(); }
        if (b.dataset.st === "edit") {
          if (st[i].wait !== undefined) {
            $("#waitMs").value = st[i].wait; EDIT.step = { i };
            openSheet("waitScrim"); $("#itemScrim").hidden = false; $("#waitScrim").style.zIndex = 31; return;
          }
          return EDITOR.openStep(i);
        }
      }
    });
    $("#itemOps").addEventListener("click", e => { const b = e.target.closest("[data-op]"); if (b) EDITOR.itemOp(b.dataset.op); });
    $("#itemMoveTo").addEventListener("change", () => EDITOR.itemOp("move"));
    // picker
    $("#pickSearch").addEventListener("input", () => EDITOR.drawPicker(""));
    $("#pickList").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) EDITOR.picked(b.dataset.id); });
    KEY_EDITOR.mount($("#pickKeys"));
    $("#pickUseKeys").addEventListener("click", () => {
      const keys = KEY_EDITOR.keys($("#pickKeys"));
      if (!keys) return toast("Pick a key first.", "warn");
      EDITOR.picked(`keys:${keys}|${KEY_EDITOR.mode($("#pickKeys"))}`);
    });
    $("#pickNone").addEventListener("click", () => EDITOR.picked(""));
    $("#pickBack").addEventListener("click", () => { EDIT.pickCb = null; $("#pickScrim").hidden = true; $("#pickScrim").style.zIndex = ""; });
    // step editor
    $("#stepAct").addEventListener("click", () => {
      $("#stepScrim").hidden = true;
      EDITOR.openPicker(EDIT.step.draft.a, ref => { EDIT.step.draft.a = ref; $("#stepScrim").hidden = false; $("#stepScrim").style.zIndex = 31; EDITOR.fillStep(); });
    });
    $("#stepSave").addEventListener("click", () => EDITOR.saveStep());
    $("#stepCancel").addEventListener("click", () => { $("#stepScrim").hidden = true; $("#stepScrim").style.zIndex = ""; });
    $("#waitSave").addEventListener("click", () => {
      const v = Math.max(50, Math.min(10000, +$("#waitMs").value || 500)), i = EDIT.step.i;
      EDITOR.mutate(() => { EDIT.ctx.item.steps[i] = { wait: v }; });
      $("#waitScrim").hidden = true; $("#waitScrim").style.zIndex = ""; EDITOR.fillItem();
    });
    // panel sheet
    $("#panelTitle").addEventListener("change", e => EDITOR.mutate(() => { EDIT.ctx.panel.t = e.target.value; }));
    $("#panelDanger").addEventListener("click", () => { const pn = EDIT.ctx.panel; EDITOR.mutate(() => { pn.danger = !pn.danger; }); flip($("#panelDanger"), !!pn.danger); });
    $("#panelDelete").addEventListener("click", () => {
      const { page, panel } = EDIT.ctx;
      if (panel.items.length && !$("#panelDelete").dataset.armed) {
        $("#panelDelete").dataset.armed = "1"; $("#panelDelete").textContent = `Tap again to delete ${panel.items.length} controls`;
        setTimeout(() => { delete $("#panelDelete").dataset.armed; $("#panelDelete").textContent = "Delete panel"; }, 3000); return;
      }
      delete $("#panelDelete").dataset.armed; $("#panelDelete").textContent = "Delete panel";
      EDITOR.mutate(() => page.panels.splice(page.panels.indexOf(panel), 1)); closeSheets();
    });
    // pages
    $("#pageList").addEventListener("change", e => { const i = e.target.dataset.pg; if (i !== undefined) EDITOR.mutate(() => { EDIT.deck.pages[+i].name = e.target.value || "Page"; }); });
    $("#pageList").addEventListener("click", e => {
      const b = e.target.closest("[data-pgop]"); if (!b) return;
      const i = +b.dataset.i, pg = EDIT.deck.pages;
      if (b.dataset.pgop === "del") { if (pg.length < 2) return toast("A deck needs at least one page.", "warn"); EDITOR.mutate(() => pg.splice(i, 1)); }
      if (b.dataset.pgop === "up" && i > 0) EDITOR.mutate(() => { [pg[i - 1], pg[i]] = [pg[i], pg[i - 1]]; });
      if (b.dataset.pgop === "down" && i < pg.length - 1) EDITOR.mutate(() => { [pg[i + 1], pg[i]] = [pg[i], pg[i + 1]]; });
      EDITOR.openPages();
    });
    $("#pageAdd").addEventListener("click", () => {
      let id; do id = "p" + Math.random().toString(36).slice(2, 7); while (EDIT.deck.pages.some(p => p.id === id));
      EDITOR.mutate(() => EDIT.deck.pages.push({ id, name: "New page", panels: [{ t: "New panel", c: 3, items: [] }] }));
      S.page = id; renderDeck(); EDITOR.openPages();
    });
    $("#pageCopy").addEventListener("click", () => {
      const src = EDIT.deck.pages.find(p => p.id === S.page); if (!src) return;
      const copy = clone(src); copy.id = "p" + Math.random().toString(36).slice(2, 7); copy.name = src.name + " copy";
      EDITOR.mutate(() => EDIT.deck.pages.push(copy)); S.page = copy.id; renderDeck(); EDITOR.openPages();
    });
    // deck props
    $("#dpName").addEventListener("change", e => { EDITOR.mutate(() => { EDIT.deck.name = e.target.value.trim() || "My deck"; }); updateDeckChip(); });
    $("#dpAbout").addEventListener("change", e => EDITOR.mutate(() => { EDIT.deck.about = e.target.value; }));
    $("#dpMatch").addEventListener("change", e => EDITOR.mutate(() => { EDIT.deck.match = e.target.value.split(",").map(s => s.trim()).filter(Boolean); }));
    $("#dpRoles").addEventListener("click", e => {
      const b = e.target.closest("[data-role]"); if (!b) return;
      const roles = new Set(EDIT.deck.roles || []); roles.has(b.dataset.role) ? roles.delete(b.dataset.role) : roles.add(b.dataset.role);
      EDITOR.mutate(() => { EDIT.deck.roles = [...roles]; }); b.setAttribute("aria-pressed", roles.has(b.dataset.role));
    });
    $("#dpSkins").addEventListener("click", e => {
      const b = e.target.closest("[data-skin]"); if (!b) return;
      EDITOR.mutate(() => { EDIT.deck.skin = b.dataset.skin; });
      $$("#dpSkins .skin").forEach(x => x.setAttribute("aria-pressed", x === b));
    });
  },
};
