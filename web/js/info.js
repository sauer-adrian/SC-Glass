"use strict";
/* =====================================================================================
   Info panels: live data from Game.log (via the PC) and UEX (prices, ship specs).
   ===================================================================================== */
const EXAMPLE_GAME = {
  example: true, handle: "Example_Pilot", ship: "MISC Prospector", owner: "Example_Pilot", own_ship: true,
  location: "Stanton 1 Lorville", jurisdiction: "Hurston Dynamics", armistice: false, qt_target: "Stanton 2b Daymar",
  started: Date.now() / 1000 - 5400, contracts: { "Mine Quantanium for Shubin": "accepted", "Deliver to Area18": "completed" },
  counts: { injuries: 1, incapacitated: 0, fines: 0, qt_jumps: 6, crimes: 0 },
  feed: [
    { type: "ship_boarded", data: { ship: "MISC Prospector" }, ts: "" },
    { type: "qt_target", data: { destination: "Stanton2b_Daymar" }, ts: "" },
    { type: "contract_accepted", data: { name: "Mine Quantanium for Shubin" }, ts: "" },
  ],
  shipinfo: { name: "MISC Prospector", maker: "Musashi Industrial & Starflight Concern", scu: 32, crew: 1, pad: "S", roles: ["mining", "industrial"] },
  log: "", log_error: "",
};
const MARKET = { names: null, cache: {} };
const EVENT_TEXT = {
  ship_boarded: d => `Boarded ${d.ship}`, ship_exited: d => `Left ${d.ship}`, location: d => `At ${prettyLoc(d.location)}`,
  qt_target: d => `Quantum target ${prettyLoc(d.destination)}`, qt_arrived: () => "Quantum arrived",
  contract_accepted: d => `Contract accepted: ${d.name}`, contract_completed: d => `Contract complete: ${d.name}`,
  contract_failed: d => `Contract failed: ${d.name}`, objective: d => `Objective: ${d.name}`, objective_complete: d => `Objective done: ${d.name}`,
  jurisdiction: d => `Entered ${d.name} jurisdiction`, armistice_entered: () => "Entered armistice zone", armistice_exited: () => "Left armistice zone",
  monitored_entered: () => "Entered monitored space", monitored_exited: () => "Left monitored space", crimestat: () => "CrimeStat increased",
  fined: d => `Fined ${d.amount} UEC`, injury: d => `${d.severity} injury: ${d.part}`, incapacitated: () => "Incapacitated",
  fatal_collision: () => "Fatal collision", refinery_complete: d => `Refinery order done at ${d.location}`, impounded: d => `Vehicle impounded: ${d.reason}`,
  hangar_ready: () => "Hangar ready", server_joined: d => `Joined server ${d.shard}`, emergency_services: () => "Emergency services on the way",
  player_login: d => `Signed in as ${d.handle}`,
};
function prettyLoc(s) { return String(s || "").replace(/_/g, " ").replace(/\b(Stanton|Pyro|Nyx)(\d)([a-z]?)\b/g, "$1 $2$3"); }
function evTime(ts) { if (!ts) return ""; const d = new Date(ts); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
function dur(sec) { const m = Math.max(0, Math.floor(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }

const INFO_TILES = {
  build(item) {
    const el = document.createElement("div");
    el.className = "info src-" + item.src;
    el.dataset.refs = "[]";
    if (item.src === "market") {
      el.innerHTML = `<h4>Market</h4>
        <div class="mk-head"><select aria-label="Commodity"></select><button class="btn small" type="button">Refresh</button></div>
        <div class="two"><div class="scroll"><table><thead><tr><th>Best place to sell</th><th class="num">aUEC/SCU</th></tr></thead><tbody class="sell"></tbody></table></div>
        <div class="scroll"><table><thead><tr><th>Cheapest to buy</th><th class="num">aUEC/SCU</th></tr></thead><tbody class="buy"></tbody></table></div></div>
        <div class="muted mk-note"></div>`;
      const sel = el.querySelector("select");
      sel.addEventListener("change", () => { store.set("mk." + (item.commodity || "x"), sel.value); INFO_TILES.loadMarket(el, sel.value, false); });
      el.querySelector("button").addEventListener("click", () => INFO_TILES.loadMarket(el, sel.value, true));
      el._item = item;
    }
    return el;
  },
  render(item, el) {
    const g = S.game || {};
    const ex = g.example ? '<span class="tag ex">EXAMPLE</span>' : "";
    const none = msg => `<p class="muted">${msg}</p>`;
    const noLink = !S.demo && !S.authed;
    if (item.src === "ship") {
      const si = g.shipinfo;
      el.innerHTML = `<h4>Ship</h4>${ex}` + (noLink ? none("Waiting for the link to your PC.") : !g.ship ? none(g.log || S.demo ? "Not in a ship. Board one and this fills in." : "Ship detection needs Star Citizen's Game.log. It appears after the game has run once.") :
        `<div class="big">${esc(g.ship)}</div>
         <div class="sub2">${esc(si?.maker || "")}${g.owner && !g.own_ship ? ` · ${esc(g.owner)}'s ship` : ""}</div>
         ${si ? `<dl class="rows"><dt>Cargo</dt><dd>${si.scu ?? "—"} SCU</dd><dt>Crew</dt><dd>${si.crew ?? "—"}</dd><dt>Pad</dt><dd>${esc(si.pad || "—")}</dd></dl>
         <div class="chips2">${(si.roles || []).map(r => `<span>${esc(r.replace("_", " "))}</span>`).join("")}</div>` : '<p class="muted">Specs load from UEX when your PC is online.</p>'}`);
    } else if (item.src === "location") {
      el.innerHTML = `<h4>Location</h4>${ex}` + (noLink ? none("Waiting for the link to your PC.") : !g.location && !g.jurisdiction ? none("No location yet. It updates as you move around.") :
        `<div class="big">${esc(g.location || "Unknown")}</div>
         <dl class="rows"><dt>Jurisdiction</dt><dd>${esc(g.jurisdiction || "—")}</dd>
         <dt>Quantum</dt><dd>${g.qt_target ? "Heading to " + esc(g.qt_target) : "No target"}</dd></dl>
         <div class="chips2">${g.armistice ? "<span>ARMISTICE</span>" : '<span class="warn">WEAPONS FREE</span>'}</div>`);
    } else if (item.src === "session") {
      const c = g.counts || {}, ct = Object.entries(g.contracts || {});
      el.innerHTML = `<h4>Session</h4>${ex}` + (noLink ? none("Waiting for the link to your PC.") :
        `<dl class="rows"><dt>Playing</dt><dd>${g.started ? dur(Date.now() / 1000 - g.started) : "—"}${g.handle ? " as " + esc(g.handle) : ""}</dd>
         <dt>Jumps</dt><dd>${c.qt_jumps ?? 0} quantum</dd><dt>Injuries</dt><dd>${c.injuries ?? 0}${c.incapacitated ? `, downed ${c.incapacitated}×` : ""}</dd>
         <dt>Fines</dt><dd>${c.fines ? c.fines + " UEC" : "none"}</dd></dl>
         <div class="scroll"><dl class="rows">${ct.length ? ct.slice(-5).map(([n, s]) => `<dt>${esc(s)}</dt><dd>${esc(n)}</dd>`).join("") : "<dt>Contracts</dt><dd>none yet</dd>"}</dl></div>`);
    } else if (item.src === "feed") {
      const f = (g.feed || []).slice().reverse();
      el.innerHTML = `<h4>Game log</h4>${ex}` + (noLink ? none("Waiting for the link to your PC.") : !f.length ? none("Events from Star Citizen show up here as they happen.") :
        `<ul class="feed">${f.map(e => `<li><time>${esc(evTime(e.ts))}</time><span>${esc((EVENT_TEXT[e.type] || (() => e.type))(e.data || {}))}</span></li>`).join("")}</ul>`);
    } else if (item.src === "market") {
      INFO_TILES.renderMarket(item, el);
    }
  },
  async renderMarket(item, el) {
    const sel = el.querySelector("select");
    if (S.demo) {
      sel.innerHTML = `<option>${esc(item.commodity || "Laranite")}</option>`; sel.disabled = true;
      el.querySelector(".sell").innerHTML = el.querySelector(".buy").innerHTML = "";
      el.querySelector(".mk-note").textContent = "Live prices load from UEX through SC Glass on your PC. Connect it to see where to sell.";
      return;
    }
    if (!S.authed) { el.querySelector(".mk-note").textContent = "Waiting for the link to your PC."; return; }
    if (!MARKET.names) {
      el.querySelector(".mk-note").textContent = "Loading commodities…";
      const r = await request({ t: "commodities" });
      MARKET.names = r && r.names && r.names.length ? r.names : [];
      if (!MARKET.names.length) { el.querySelector(".mk-note").textContent = r?.error ? `Prices unavailable: ${r.error}. Your PC needs internet for UEX.` : "No price data."; return; }
    }
    const want = store.get("mk." + (item.commodity || "x"), item.commodity || MARKET.names[0]);
    if (!sel.options.length) sel.innerHTML = MARKET.names.map(n => `<option>${esc(n)}</option>`).join("");
    sel.value = MARKET.names.includes(want) ? want : MARKET.names[0];
    INFO_TILES.loadMarket(el, sel.value, false);
  },
  async loadMarket(el, name, force) {
    const c = MARKET.cache[name];
    if (c && !force && Date.now() - c.at < 300000) return INFO_TILES.drawMarket(el, c.data);
    el.querySelector(".mk-note").textContent = "Loading prices…";
    const r = await request({ t: "market", commodity: name });
    if (!r) { el.querySelector(".mk-note").textContent = "No answer from your PC."; return; }
    MARKET.cache[name] = { at: Date.now(), data: r };
    INFO_TILES.drawMarket(el, r);
  },
  drawMarket(el, r) {
    const row = x => `<tr><td>${esc(x.terminal)}</td><td class="num">${Number(x.price).toLocaleString()}</td></tr>`;
    el.querySelector(".sell").innerHTML = (r.sell || []).map(row).join("") || `<tr><td colspan="2" class="muted">Nobody buys this right now</td></tr>`;
    el.querySelector(".buy").innerHTML = (r.buy || []).map(row).join("") || `<tr><td colspan="2" class="muted">Not sold anywhere</td></tr>`;
    const newest = Math.max(0, ...[...(r.sell || []), ...(r.buy || [])].map(x => +x.updated || 0));
    el.querySelector(".mk-note").textContent = r.error ? r.error : `Prices from UEX, reported by players${newest ? `, newest ${dur(Date.now() / 1000 - newest)} ago` : ""}.`;
  },
};
