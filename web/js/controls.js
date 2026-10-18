"use strict";
/* =====================================================================================
   Controls. Each kind has build(item, cell) -> element and render(item, cell).
   ===================================================================================== */
function makeSw(item, opts = {}) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "sw" + (item.tone ? " " + item.tone : "");
  el.innerHTML = `<span class="lg"></span>${opts.half ? "" : '<span class="st"></span>'}<span class="kc"></span><span class="sweep"></span>${opts.guard ? '<span class="cover"></span>' : ""}${opts.seq ? '<span class="chip-seq">SEQ</span>' : ""}`;
  const text = opts.label ?? item.lg ?? "";
  const lg = el.querySelector(".lg");
  lg.textContent = text;
  if (String(text).split(" ").some(w => w.length > 9)) lg.classList.add("tight");
  el.dataset.refs = JSON.stringify(opts.refs || []);
  return el;
}
const refsOf = a => (Array.isArray(a) ? a : [a]).filter(Boolean);
const swOf = cell => cell.querySelector(".sw");

function renderKeyLegend(el, item, ref, { lampText, lampColor, lit } = {}) {
  const b = pick(ref);
  const st = el.querySelector(".st"), kc = el.querySelector(".kc");
  const unbound = !b.keys, keyTxt = unbound ? "" : fmtKeys(b.keys);
  el.classList.toggle("unbound", unbound);
  if (!st) { kc.textContent = S.mode === "keys" ? (keyTxt || "—") : ""; return; }
  st.className = "st";
  if (S.mode === "keys") {
    st.textContent = unbound ? "NOT SET" : keyTxt; st.classList.add(unbound ? "c-unbound" : "k");
    kc.textContent = ""; el.classList.remove("lit"); return;
  }
  if (unbound) { st.textContent = "UNBOUND"; st.classList.add("c-unbound"); kc.textContent = ""; el.classList.remove("lit"); return; }
  if (lampText !== undefined) {
    st.textContent = lampText; st.classList.add("c-" + lampColor); kc.textContent = keyTxt; el.classList.toggle("lit", !!lit);
  } else {
    st.textContent = (b.mode === "hold" || item.k === "hold" ? "HOLD " : "") + keyTxt; st.classList.add("k");
    kc.textContent = ""; el.classList.remove("lit");
  }
}

const CONTROLS = {
  pulse: {
    build(item) {
      const el = makeSw(item, { refs: refsOf(item.a) });
      bindPress(el, {
        hold: () => spec(pick(item.a).mode).hold,
        holdStart: () => holdStart(el, item.a, item.lg), holdEnd: () => holdEnd(el),
        tap: async () => { sound("click"); if (await fire(item.a, el, { label: item.lg }) && item.sets) setStates(item.sets); },
      });
      return el;
    },
    render(item, cell) { renderKeyLegend(swOf(cell), item, item.a); },
  },

  hold: {
    build(item) {
      const el = makeSw(item, { refs: refsOf(item.a) });
      el.classList.add("hold");
      bindPress(el, {
        hold: () => true, holdStart: () => holdStart(el, item.a, item.lg), holdEnd: () => holdEnd(el),
        tap: (_, kb) => { if (kb) { sound("click"); fire(item.a, el, { label: item.lg, ms: 300 }); } },
      });
      return el;
    },
    render(item, cell) { renderKeyLegend(swOf(cell), item, item.a); },
  },

  cycle: {
    build(item) {
      const el = makeSw(item, { refs: refsOf(item.a) });
      bindPress(el, {
        tap: async () => {
          const next = nextLamp(item);
          const lamp = (LAMPS[item.lamp] || item.v || LAMPS.onoff).find(x => x[0] === next);
          sound(lamp && lamp[2] === "off" ? "off" : "on");
          if (await fire(item.a, el, { label: item.lg })) setState(item.s, next);
        },
        long: () => {
          sound("snap"); setState(item.s, nextLamp(item));
          toast(`${item.lg} light set to ${lampFor(item)[1].toLowerCase()}. No key sent.`);
        },
      });
      return el;
    },
    render(item, cell) {
      const [, text, color] = lampFor(item);
      renderKeyLegend(swOf(cell), item, item.a, { lampText: text, lampColor: color, lit: color !== "off" });
    },
  },

  sel: {
    build(item) {
      const el = makeSw(item, { refs: refsOf(item.a) });
      bindPress(el, {
        tap: async () => {
          sound("on");
          const on = String(S.states[item.g]) === String(item.val);
          if (await fire(item.a, el, { label: item.lg })) setState(item.g, on && item.back ? item.back : item.val);
        },
        long: () => {
          sound("snap");
          const on = String(S.states[item.g]) === String(item.val);
          setState(item.g, on ? (item.back || "GUNS") : item.val);
          toast(`Mode light set to ${String(S.states[item.g]).toLowerCase()}. No key sent.`);
        },
      });
      return el;
    },
    render(item, cell) {
      const on = String(S.states[item.g]) === String(item.val);
      if (on) renderKeyLegend(swOf(cell), item, item.a, { lampText: "ACTIVE", lampColor: "green", lit: true });
      else renderKeyLegend(swOf(cell), item, item.a);
    },
  },

  guard: {
    build(item) {
      const el = makeSw(item, { refs: refsOf(item.a), guard: true });
      bindPress(el, {
        tap: async () => {
          if (!pick(item.a).keys) return unboundWarn(el, pick(item.a).name);
          if (!el.classList.contains("armed")) {
            sound("snap"); el.classList.add("armed"); CONTROLS.guard.render(item, el.parentElement);
            readout(`<b>${esc(item.lg.toUpperCase())}</b> guard open. Tap again to confirm.`);
            clearTimeout(el._armT);
            el._armT = setTimeout(() => { el.classList.remove("armed"); CONTROLS.guard.render(item, el.parentElement); }, 4000);
            return;
          }
          clearTimeout(el._armT); el.classList.remove("armed"); CONTROLS.guard.render(item, el.parentElement);
          sound("clack");
          await fire(item.a, el, { label: item.lg });
        },
      });
      return el;
    },
    render(item, cell) {
      const el = swOf(cell);
      if (el.classList.contains("armed") && S.mode === "play") renderKeyLegend(el, item, item.a, { lampText: "ARMED", lampColor: "red", lit: true });
      else renderKeyLegend(el, item, item.a);
    },
  },

  macro: {
    build(item) {
      const refs = [...new Set((item.steps || []).map(s => s.a).filter(Boolean).flatMap(refsOf))];
      const el = makeSw(item, { refs, seq: true });
      bindPress(el, { tap: () => runMacro(item, el) });
      return el;
    },
    render(item, cell) {
      const el = swOf(cell), st = el.querySelector(".st"), kc = el.querySelector(".kc");
      const { out, missing } = expandMacro(item.steps);
      const n = out.filter(s => s.keys).length;
      st.className = "st"; kc.textContent = "";
      if (S.mode === "keys") { st.textContent = `${(item.steps || []).filter(s => s.a).length} ACTIONS`; st.classList.add("k"); return; }
      if (!n && missing.length) { st.textContent = "UNBOUND"; st.classList.add("c-unbound"); }
      else if (!n) { st.textContent = "DONE"; st.classList.add("c-green"); }
      else { st.textContent = `${n} STEP${n > 1 ? "S" : ""}`; st.classList.add("k"); }
      el.classList.toggle("lit", n === 0 && !missing.length);
    },
  },

  rocker: {
    build(item) {
      const wrap = document.createElement("div");
      wrap.className = "rk" + (item.vertical ? " vert" : "");
      wrap.innerHTML = `<div class="rk-lg"></div><div class="rk-caps"></div>`;
      wrap.querySelector(".rk-lg").textContent = item.lg || "";
      const [l1, l2] = item.labels || ["−", "+"];
      for (const [ref, label] of [[item.dn, l1], [item.up, l2]]) {
        const el = makeSw(item, { half: true, label, refs: refsOf(ref) });
        el.classList.add("half");
        bindPress(el, {
          repeat: item.rep === false ? 0 : 160,
          tap: rep => { sound(rep ? "tick" : "click"); fire(ref, el, { label: `${item.lg} ${label}`, quiet: rep }); },
        });
        wrap.querySelector(".rk-caps").append(el);
      }
      return wrap;
    },
    render(item, cell) {
      const halves = cell.querySelectorAll(".sw");
      [item.dn, item.up].forEach((ref, i) => { if (halves[i]) renderKeyLegend(halves[i], item, ref); });
    },
  },

  slider: {
    build(item) {
      const max = Math.max(1, Math.min(12, item.max || 4));
      const el = document.createElement("div");
      el.className = "sld" + (item.tone ? " tone-" + (item.tone === "red" ? "red" : item.tone === "blue" ? "blue" : "amber") : "");
      el.dataset.refs = JSON.stringify([item.dn, item.up].filter(Boolean));
      el.innerHTML = `<div class="ctl-lg"></div><div class="sld-track">${'<i class="pip"></i>'.repeat(max)}</div><div class="sld-val"></div>`;
      el.querySelector(".ctl-lg").textContent = item.lg || "";
      const track = el.querySelector(".sld-track");
      let drag = null;
      const valueAt = y => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(max, Math.round((1 - (y - r.top) / r.height) * max + 0.4))); };
      const stepTo = target => {
        let cur = +S.states[item.s] || 0;
        while (cur !== target) {
          const up = target > cur;
          cur += up ? 1 : -1;
          if (!drag.lightOnly) fire(up ? item.up : item.dn, null, { label: `${item.lg} ${up ? "+" : "−"}`, quiet: true });
          sound("tick");
        }
        setState(item.s, cur);
        readout(`<b>${esc(item.lg)}</b> ${cur} / ${max}${drag.lightOnly ? ' <span class="x">light only, no keys sent</span>' : ""}`);
      };
      el.addEventListener("pointerdown", e => {
        if (S.mode !== "play" || e.button > 0) return;
        try { el.setPointerCapture(e.pointerId); } catch {}
        wake();
        const b1 = pick(item.up), b2 = pick(item.dn);
        if (!b1.keys || !b2.keys) return unboundWarn(el, !b1.keys ? b1.name : b2.name);
        drag = { y: e.clientY, moved: false, lightOnly: false };
        drag.lt = setTimeout(() => { if (drag && !drag.moved) { drag.lightOnly = true; el.classList.add("busy"); sound("snap"); toast(`${item.lg}: slide to correct the light. No keys will be sent.`); } }, 650);
      });
      el.addEventListener("pointermove", e => {
        if (!drag) return;
        if (Math.abs(e.clientY - drag.y) > 6) { drag.moved = true; clearTimeout(drag.lt); }
        if (drag.moved) { const v = valueAt(e.clientY); if (v !== (+S.states[item.s] || 0)) stepTo(v); }
      });
      const end = e => {
        if (!drag) return;
        clearTimeout(drag.lt);
        if (!drag.moved && !drag.lightOnly && e && e.type === "pointerup") stepTo(valueAt(e.clientY));
        el.classList.remove("busy"); drag = null;
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", () => { if (drag) { clearTimeout(drag.lt); el.classList.remove("busy"); drag = null; } });
      return el;
    },
    render(item, cell) {
      const el = cell.firstElementChild, max = Math.max(1, Math.min(12, item.max || 4));
      const v = Math.max(0, Math.min(max, +S.states[item.s] || 0));
      el.querySelectorAll(".pip").forEach((p, i) => p.classList.toggle("on", i < v));
      const b = pick(item.up);
      el.querySelector(".sld-val").textContent = S.mode === "keys" ? fmtKeys(b.keys) || "NOT SET" : `${v}/${max}`;
    },
  },

  dial: {
    build(item) {
      const el = document.createElement("div");
      el.className = "knob-wrap dial";
      el.dataset.refs = JSON.stringify([item.dn, item.up].filter(Boolean));
      el.innerHTML = `<div class="ctl-lg"></div><div class="knob-area"><div class="knob"></div><span class="dial-read"></span></div>`;
      el.querySelector(".ctl-lg").textContent = item.lg || "";
      const knob = el.querySelector(".knob"), area = el.querySelector(".knob-area");
      const detent = item.detent || 30;
      let angle = 0, d = null;
      const center = () => { const r = knob.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const ang = (x, y) => { const [cx, cy] = center(); return Math.atan2(x - cx, cy - y) * 180 / Math.PI; };
      const step = up => {
        fire(up ? item.up : item.dn, null, { label: `${item.lg} ${up ? "+" : "−"}`, quiet: true });
        sound("tick");
        angle += up ? detent : -detent;
        knob.style.setProperty("--a", angle + "deg");
        el.querySelector(".dial-read").textContent = up ? "+1" : "−1";
        readout(`<b>${esc(item.lg)}</b> ${up ? "+" : "−"}`);
      };
      area.addEventListener("pointerdown", e => {
        if (S.mode !== "play" || e.button > 0) return;
        try { area.setPointerCapture(e.pointerId); } catch {}
        const b1 = pick(item.up), b2 = pick(item.dn);
        if (!b1.keys || !b2.keys) return unboundWarn(el, !b1.keys ? b1.name : b2.name);
        d = { x: e.clientX, y: e.clientY, last: ang(e.clientX, e.clientY), acc: 0, moved: false };
      });
      area.addEventListener("pointermove", e => {
        if (!d) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
        const a = ang(e.clientX, e.clientY);
        let delta = a - d.last; if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
        d.last = a; d.acc += delta;
        knob.style.setProperty("--a", (angle + d.acc) + "deg");
        while (Math.abs(d.acc) >= detent) { const up = d.acc > 0; d.acc -= up ? detent : -detent; step(up); }
      });
      const end = e => {
        if (!d) return;
        if (!d.moved && e.type === "pointerup") { const [cx] = center(); step(e.clientX >= cx); }
        knob.style.setProperty("--a", angle + "deg"); d = null;
      };
      area.addEventListener("pointerup", end);
      area.addEventListener("pointercancel", end);
      return el;
    },
    render(item, cell) {
      const el = cell.firstElementChild, b = pick(item.up), b2 = pick(item.dn);
      el.classList.toggle("unbound", !b.keys || !b2.keys);
      el.querySelector(".dial-read").textContent = S.mode === "keys" ? (fmtKeys(b.keys) || "NOT SET") : (!b.keys || !b2.keys ? "UNBOUND" : "");
    },
  },

  selector: {
    build(item) {
      const opts = item.opts || [];
      const el = document.createElement("div");
      el.className = "knob-wrap selector";
      el.dataset.refs = JSON.stringify(opts.flatMap(o => refsOf(o.a)));
      el.innerHTML = `<div class="ctl-lg"></div><div class="knob-area"><div class="knob" style="height:52%;width:auto"></div><div class="sel-opts"></div></div>`;
      el.querySelector(".ctl-lg").textContent = item.lg || "";
      const n = opts.length, span = n <= 2 ? 90 : Math.min(240, 60 * (n - 1));
      const angles = opts.map((_, i) => n === 1 ? 0 : -span / 2 + span * i / (n - 1));
      el._angles = angles;
      const box = el.querySelector(".sel-opts");
      opts.forEach((o, i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sel-opt"; b.textContent = o.lg || o.val;
        const a = angles[i] * Math.PI / 180;
        b.style.left = (50 + Math.sin(a) * 40) + "%"; b.style.top = (50 - Math.cos(a) * 40) + "%";
        b.addEventListener("click", () => { if (S.mode === "play") choose(o, el); });
        box.append(b);
      });
      const choose = async (o, src) => {
        const b = pick(o.a);
        if (!b.keys) return unboundWarn(src, b.name);
        if (String(S.states[item.g]) === String(o.val)) return;
        sound("clack");
        if (await fire(o.a, null, { label: `${item.lg}: ${o.lg || o.val}` })) setState(item.g, o.val);
      };
      const knob = el.querySelector(".knob"), area = el.querySelector(".knob-area");
      let d = null;
      area.addEventListener("pointerdown", e => {
        if (S.mode !== "play" || e.button > 0 || e.target.closest(".sel-opt")) return;
        try { area.setPointerCapture(e.pointerId); } catch {}
        d = { moved: false };
      });
      area.addEventListener("pointermove", e => {
        if (!d) return;
        const r = knob.getBoundingClientRect(), a = Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY) * 180 / Math.PI;
        d.moved = true; d.a = Math.max(angles[0] - 20, Math.min(angles[n - 1] + 20, a));
        knob.style.setProperty("--a", d.a + "deg");
      });
      const end = () => {
        if (!d) return;
        if (d.moved && n) {
          let best = 0; angles.forEach((a, i) => { if (Math.abs(a - d.a) < Math.abs(angles[best] - d.a)) best = i; });
          choose(opts[best], el);
        }
        d = null; CONTROLS.selector.render(item, el.parentElement);
      };
      area.addEventListener("pointerup", end);
      area.addEventListener("pointercancel", end);
      return el;
    },
    render(item, cell) {
      const el = cell.firstElementChild, opts = item.opts || [];
      const i = Math.max(0, opts.findIndex(o => String(o.val) === String(S.states[item.g])));
      const known = opts.some(o => String(o.val) === String(S.states[item.g]));
      el.querySelector(".knob").style.setProperty("--a", (known ? el._angles[i] : el._angles[0] || 0) + "deg");
      el.querySelectorAll(".sel-opt").forEach((b, j) => {
        const bd = pick(opts[j].a);
        b.classList.toggle("on", known && j === i);
        b.classList.toggle("unbound", !bd.keys);
        b.title = bd.keys ? `${bd.name}: ${fmtKeys(bd.keys)}` : `${bd.name}: no key`;
        if (S.mode === "keys") b.textContent = bd.keys ? fmtKeys(bd.keys) : "—"; else b.textContent = opts[j].lg || opts[j].val;
      });
    },
  },

  lever: {
    build(item) {
      const el = document.createElement("div");
      el.className = "lever";
      el.dataset.refs = JSON.stringify([item.dn, item.up].filter(Boolean));
      el.innerHTML = `<div class="ctl-lg"></div><div class="lever-slot"><div class="lever-scale">${"<i></i>".repeat(11)}</div><div class="lever-handle"><span></span></div></div><div class="lever-mode"></div>`;
      el.querySelector(".ctl-lg").textContent = item.lg || "";
      const slot = el.querySelector(".lever-slot");
      let d = null, sendT = 0, pendingV = null;
      const axisMode = () => S.vjoy && S.vjoy.ok && (S.vjoy.axes || []).includes(item.axis || "z");
      const N = Math.max(2, item.steps || 10);
      const sendAxis = v => {
        pendingV = v;
        if (sendT) return;
        sendT = setTimeout(() => { sendT = 0; if (S.authed) wsSend({ t: "axis", axis: item.axis || "z", value: pendingV }); }, 33);
      };
      const setP = (p, quiet) => {
        p = Math.max(0, Math.min(1, p));
        const old = +S.states[item.s] || 0;
        if (axisMode()) sendAxis(p);
        else {
          const a = Math.round(old * N), b = Math.round(p * N);
          for (let i = 0; i < Math.abs(b - a); i++) fire(b > a ? item.up : item.dn, null, { quiet: true });
          if (a !== b) sound("tick");
        }
        S.states[item.s] = p; store.set("states", S.states);
        el.style.setProperty("--p", p);
        el.querySelector(".lever-handle span").textContent = Math.round(p * 100) + "%";
        if (!quiet) readout(`<b>${esc(item.lg)}</b> ${Math.round(p * 100)}%${axisMode() ? ` · vJoy ${esc((item.axis || "z").toUpperCase())}` : ""}${S.demo ? ' <span class="x">demo</span>' : ""}`);
      };
      const at = y => { const r = slot.getBoundingClientRect(); return 1 - (y - r.top - 18) / Math.max(1, r.height - 36); };
      el.addEventListener("pointerdown", e => {
        if (S.mode !== "play" || e.button > 0) return;
        if (!axisMode() && (!pick(item.up).keys || !pick(item.dn).keys)) return unboundWarn(el, pick(item.up).name);
        try { el.setPointerCapture(e.pointerId); } catch {}
        wake(); d = {}; setP(at(e.clientY));
      });
      el.addEventListener("pointermove", e => { if (d) setP(at(e.clientY)); });
      const end = () => {
        if (!d) return; d = null;
        if (item.spring) setP(item.spring === "center" ? 0.5 : 0);
        if (S.authed) wsSend({ t: "state", key: item.s, value: S.states[item.s] });
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      return el;
    },
    render(item, cell) {
      const el = cell.firstElementChild, p = Math.max(0, Math.min(1, +S.states[item.s] || 0));
      el.style.setProperty("--p", p);
      el.querySelector(".lever-handle span").textContent = Math.round(p * 100) + "%";
      const axis = S.vjoy && S.vjoy.ok && (S.vjoy.axes || []).includes(item.axis || "z");
      el.querySelector(".lever-mode").textContent = S.mode === "keys" ? (fmtKeys(pick(item.up).keys) || "NOT SET")
        : axis ? `vJoy ${(item.axis || "z").toUpperCase()} axis` : `${item.steps || 10} steps · keys`;
    },
  },

  pad: {
    build(item) {
      const el = document.createElement("div");
      el.className = "pad"; el.dataset.refs = "[]";
      el.innerHTML = `<div class="ctl-lg"></div><div class="pad-hint">Drag to move · tap to click · hold to drag · two fingers for right click</div><div class="dot"></div>`;
      el.querySelector(".ctl-lg").textContent = item.lg || "Trackpad";
      const pts = new Map();
      let g = null, acc = [0, 0], raf = 0;
      const flush = () => { raf = 0; const [dx, dy] = acc; acc = [0, 0]; if ((dx || dy) && S.authed) wsSend({ t: "move", dx: Math.round(dx), dy: Math.round(dy) }); };
      el.addEventListener("pointerdown", e => {
        if (S.mode !== "play") return;
        try { el.setPointerCapture(e.pointerId); } catch {}
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        wake();
        if (pts.size === 2) { if (g) { clearTimeout(g.lt); g.two = true; } return; }
        g = { t0: performance.now(), sx: e.clientX, sy: e.clientY, moved: false, dragging: false, two: false };
        el.classList.add("active");
        const r = el.getBoundingClientRect(), dot = el.querySelector(".dot");
        dot.style.left = (e.clientX - r.left) + "px"; dot.style.top = (e.clientY - r.top) + "px";
        g.lt = setTimeout(() => { if (g && !g.moved) { g.dragging = true; sound("snap"); holdStart(el, "keys:mouse1|hold", "Mouse button"); } }, 450);
      });
      el.addEventListener("pointermove", e => {
        const p = pts.get(e.pointerId); if (!p || !g || pts.size > 1) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) { g.moved = true; clearTimeout(g.lt); }
        const sens = (item.sens || 1.6) * (window.devicePixelRatio > 1 ? 1.2 : 1);
        acc[0] += dx * sens; acc[1] += dy * sens;
        if (!raf) raf = requestAnimationFrame(flush);
        const r = el.getBoundingClientRect(), dot = el.querySelector(".dot");
        dot.style.left = (e.clientX - r.left) + "px"; dot.style.top = (e.clientY - r.top) + "px";
      });
      const end = e => {
        pts.delete(e.pointerId);
        if (!g || pts.size) return;
        clearTimeout(g.lt);
        el.classList.remove("active");
        if (g.dragging) holdEnd(el);
        else if (e.type === "pointerup" && !g.moved && performance.now() - g.t0 < 350) {
          sound("click"); fire(g.two ? "keys:mouse2|tap" : "keys:mouse1|tap", null, { label: g.two ? "Right click" : "Click" });
        }
        g = null;
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      return el;
    },
    render() {},
  },

  info: {
    build(item) { return INFO_TILES.build(item); },
    render(item, cell) { INFO_TILES.render(item, cell.firstElementChild); },
  },
};
const KINDS = {
  pulse: "Button", cycle: "Switch with light", sel: "Mode button", hold: "Hold button", guard: "Guarded button",
  macro: "Sequence", rocker: "Rocker (− / +)", slider: "Power slider", dial: "Rotary dial", selector: "Rotary selector",
  lever: "Throttle lever", pad: "Trackpad", info: "Info panel",
};
