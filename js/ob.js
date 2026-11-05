// Official Business (OB). Filed on the File leave page (type "Official Business"), approved like leave.
// On the day, on the phone: the employee checks in at the place with a photo stamped with the location and time (geo-tag),
// or also turns on tracking (location points every few minutes while the app is open). Approvers, managers above and HR
// see the check-ins on the request.
import { storageUpload, openStoredFile, rest } from "./api.js";
import { sign } from "./sign.js";

const BUCKET = "iaf-ob";
const modes = {};                                                                                // mode picked on this phone, per request
const trk = { watch: null, req: null, sent: 0, last: null, lastAt: 0, wake: null, err: "" };   // one tracking session per open app
const fmtT = (iso) => (iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const metres = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone or browser cannot share its location."));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? "Location is blocked. Allow location for this app in the phone settings, then try again." : "Could not get your location. Go outside or near a window and try again.")),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}

// Draws the photo (max 1600 px) with a band showing who, where, the coordinates and the time. Returns a JPEG blob.
export async function stampPhoto(file, lines) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file is not a photo.")); i.src = url; });
    const sc = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * sc), h = Math.round(img.height * sc);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    const fs = Math.max(14, Math.round(w / 45)), pad = Math.round(fs * 0.6), bh = lines.length * (fs + 6) + pad * 2;
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(0, h - bh, w, bh);
    g.fillStyle = "#fff"; g.font = `${fs}px system-ui, sans-serif`; g.textBaseline = "top";
    lines.forEach((t, i) => g.fillText(t, pad, h - bh + pad + i * (fs + 6), w - pad * 2));
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  } finally { URL.revokeObjectURL(url); }
}

function pickPhoto() {
  return new Promise((resolve) => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
    inp.onchange = () => resolve(inp.files[0] || null); inp.click();
  });
}

async function sendPoint(rpc, pos) {
  const now = Date.now();
  if (trk.last && now - trk.lastAt < 120000 && metres(trk.last, pos) < 150) return;   // every 2 minutes, or sooner after moving 150 m
  try { const id = await rpc("iaf_ob_checkin", { p_request: trk.req, p_kind: "point", p_mode: "tracking", p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.acc, p_photo: null, p_note: null, p_taken_at: new Date().toISOString() });
    if (id) { trk.sent++; trk.last = pos; trk.lastAt = now; } trk.err = ""; } catch (e) { trk.err = e.message; }
}
export function startTracking(rpc, requestId, onUpdate) {
  stopTracking();
  if (!navigator.geolocation) throw new Error("This phone or browser cannot share its location.");
  trk.req = requestId; trk.sent = 0; trk.last = null; trk.lastAt = 0; trk.err = "";
  trk.watch = navigator.geolocation.watchPosition((p) => { sendPoint(rpc, { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }).then(() => onUpdate && onUpdate()); },
    (e) => { trk.err = e.code === 1 ? "Location is blocked for this app." : "Location not available right now."; onUpdate && onUpdate(); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { trk.wake = w; }).catch(() => {});
}
export function stopTracking() {
  if (trk.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(trk.watch);
  trk.watch = null; trk.req = null; if (trk.wake) { trk.wake.release().catch(() => {}); trk.wake = null; }
}

// ---------- the OB page ----------
export async function renderOb(el0, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  const tab = state.obTab === "hr" && state.canPeople ? "hr" : "mine";
  el0.innerHTML = `${state.canPeople ? `<div class="cotabs"><button class="cotab${tab === "mine" ? " on" : ""}" data-obtab="mine">Official business</button><button class="cotab${tab === "hr" ? " on" : ""}" data-obtab="hr">HR records · team OB</button></div>` : ""}<div id="obbody"><div class="empty loading">Loading…</div></div>`;
  el0.querySelectorAll("[data-obtab]").forEach((b) => (b.onclick = () => { state.obTab = b.dataset.obtab; renderOb(el0, ctx); }));
  const el = el0.querySelector("#obbody");
  if (tab === "hr") return renderTeamHr(el, ctx);
  let today, mine, tform, tinbox, tmine;
  try {
    [today, mine, tform, tinbox, tmine] = await Promise.all([rpc("iaf_ob_today"),
      rest(`leave_requests?requester_id=eq.${state.me.id}&select=id,start_date,end_date,status,detail,reason,leave_types!inner(code)&leave_types.code=eq.OB&order=start_date.desc&limit=20`).catch(() => []),
      rpc("iaf_shift_change_form").catch(() => ({ linked: false, people: [] })), rpc("iaf_obt_inbox").catch(() => []), rpc("iaf_obt_mine").catch(() => [])]);
  } catch (e) { el.innerHTML = errBox(e); return; }
  today.forEach((o) => { if (modes[o.id]) o.mode = modes[o.id]; });
  const reload = () => renderOb(el0, ctx);
  const card = (o) => {
    const tracking = trk.watch != null && trk.req === o.id;
    return `<div class="card obcard" data-ob="${esc(o.id)}"><div class="between"><h3>📍 ${esc(o.destination || "Official business")}${o.team ? ` <small class="chip mute">Team · ${o.crew} people</small>` : ""}</h3><span class="chip ${o.status === "APPROVED" || o.status === "FILED" ? "ok" : "wait"}">${o.status === "APPROVED" || o.status === "FILED" ? "Approved" : "Waiting for approval"}</span></div>
      <p class="s">${esc(o.purpose || "")}${o.time_out || o.time_in ? ` · out ${esc(o.time_out || "–")}, back ${esc(o.time_in || "–")}` : ""}</p>
      <div class="cotabs obmode"><button class="cotab${o.mode !== "tracking" ? " on" : ""}" data-mode="geotag">Geo-tag</button><button class="cotab${o.mode === "tracking" ? " on" : ""}" data-mode="tracking">Tracking</button></div>
      <p class="s">${o.mode === "tracking" ? "Take the arrival photo, then keep the app open: your location is recorded every few minutes until you check out." : "Take one photo when you arrive. The location and time are stamped on it."}</p>
      ${o.team ? `<p class="s">One arrival photo covers the whole team — whoever arrives first takes it.</p>` : ""}
      ${o.arrived_at ? `<div class="alert ok">✔ Arrived ${esc(fmtT(o.arrived_at))}${o.arrived_by ? ` (${esc(o.arrived_by)})` : ""}${o.points_today ? ` · ${o.points_today} location point(s)` : ""}${o.departed_at ? ` · left ${esc(fmtT(o.departed_at))}` : ""}</div>` : ""}
      ${tracking ? `<div class="alert warn">Tracking is on. Keep this app open. Points sent: <b>${trk.sent}</b>${trk.err ? ` · ${esc(trk.err)}` : ""}</div>` : ""}
      <div class="btns">${!o.arrived_at ? `<button class="btn primary" data-arrive>📷 I'm here — take photo</button>` : `<button class="btn" data-arrive>📷 Another photo</button>`}
        ${o.mode === "tracking" && o.arrived_at && !o.departed_at ? (tracking ? `<button class="btn" data-stop>Stop tracking</button>` : `<button class="btn" data-track>Turn on tracking</button>`) : ""}
        ${o.arrived_at && !o.departed_at ? `<button class="btn" data-depart>I'm leaving — check out</button>` : ""}</div><div class="eerr"></div></div>`;
  };
  const canTeam = tform.linked && ((tform.people || []).length > 1 || state.canPeople);
  el.innerHTML = `${today.length ? today.map(card).join("") : `<div class="card"><p>No official business today.</p></div>`}
    ${tinbox.length ? `<h2>Team OB waiting for your approval <small>${tinbox.length}</small></h2>${tinbox.map((r) => teamCard(r, esc, approveBox(r, esc))).join("")}` : ""}
    <div class="btns"><a class="btn primary" href="#/file?type=OB">+ My own official business</a>${canTeam ? `<button class="btn" data-teamform>👥 File for my team</button>` : ""}</div>
    <div id="teamform" hidden>${canTeam ? teamForm(tform, esc) : ""}</div>
    ${tmine.length ? `<h3>Team official business</h3>${tmine.map((r) => teamCard(r, esc, r.filed_by === state.me.id && ["pending", "approved"].includes(r.status) && !r.arrived_at ? `<div class="btns"><button class="btn" data-tcancel>Cancel team OB</button></div><div class="eerr"></div>` : "")).join("")}` : ""}
    <h3>My official business</h3>${mine.length ? `<div class="list">${mine.map((r) => `<a class="row" href="#/requests/${esc(r.id)}"><div class="grow"><div class="t">${esc(r.detail?.destination || "Official business")}</div>
      <div class="s">${esc(r.start_date === r.end_date ? r.start_date : r.start_date + " – " + r.end_date)} · ${esc(r.reason || "")}</div></div><span class="chip ${r.status === "APPROVED" || r.status === "FILED" ? "ok" : r.status === "REJECTED" || r.status === "CANCELLED" ? "mute" : "wait"}">${esc(r.status.replace(/_/g, " ").toLowerCase())}</span></a>`).join("")}</div>` : `<div class="empty small">None yet.</div>`}`;

  wireTeam(el, { ...ctx, tform, reload });
  el.querySelectorAll("[data-ob]").forEach((c) => {
    const o = today.find((x) => x.id === c.dataset.ob), err = c.querySelector(".eerr");
    const fail = (e) => { err.innerHTML = errBox(e); };
    c.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { modes[o.id] = b.dataset.mode; if (b.dataset.mode !== "tracking" && trk.req === o.id) stopTracking(); reload(); }));
    const arrive = c.querySelector("[data-arrive]"); if (arrive) arrive.onclick = async () => {
      err.innerHTML = ""; const file = await pickPhoto(); if (!file) return;
      arrive.disabled = true; arrive.textContent = "Getting your location…";
      try {
        const pos = await getPosition(), at = new Date();
        arrive.textContent = "Saving the photo…";
        const blob = await stampPhoto(file, [`Official Business · ${o.team ? `Team of ${o.crew} · ` : ""}${state.me.full_name}`, o.destination || "", `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}  (±${pos.acc} m)`, at.toLocaleString("en-PH")]);
        const path = `${o.id}/${at.getTime()}-arrive.jpg`;
        await storageUpload(BUCKET, path, new File([blob], "arrive.jpg", { type: "image/jpeg" }));
        await rpc("iaf_ob_checkin", { p_request: o.id, p_kind: "arrive", p_mode: o.mode || "geotag", p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.acc, p_photo: path, p_note: null, p_taken_at: at.toISOString() });
        if (o.mode === "tracking") startTracking(rpc, o.id, () => { if (location.hash.startsWith("#/ob")) reload(); });
        toast("Checked in ✔"); reload();
      } catch (e) { fail(e); arrive.disabled = false; arrive.textContent = "📷 I'm here — take photo"; }
    };
    const tr = c.querySelector("[data-track]"); if (tr) tr.onclick = () => { try { startTracking(rpc, o.id, () => { if (location.hash.startsWith("#/ob")) reload(); }); reload(); } catch (e) { fail(e); } };
    const st = c.querySelector("[data-stop]"); if (st) st.onclick = () => { stopTracking(); reload(); };
    const dp = c.querySelector("[data-depart]"); if (dp) dp.onclick = async () => {
      err.innerHTML = ""; dp.disabled = true; dp.textContent = "Getting your location…";
      try { const pos = await getPosition();
        await rpc("iaf_ob_checkin", { p_request: o.id, p_kind: "depart", p_mode: o.mode || "geotag", p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.acc, p_photo: null, p_note: null, p_taken_at: new Date().toISOString() });
        if (trk.req === o.id) stopTracking(); toast("Checked out ✔"); reload();
      } catch (e) { fail(e); dp.disabled = false; dp.textContent = "I'm leaving — check out"; }
    };
  });
}

// ---------- check-ins on a request (requester, approvers, managers above, HR) ----------
export async function renderObCheckins(box, requestId, { rpc, esc, toast, errBox }) {
  let rows; try { rows = await rpc("iaf_ob_checkins", { p_request: requestId }); } catch (e) { box.innerHTML = errBox(e); return; }
  const arr = rows.filter((r) => r.kind !== "point"), pts = rows.filter((r) => r.kind === "point");
  const KIND = { arrive: "Arrived", depart: "Left" };
  box.innerHTML = `<div class="card"><h3>📍 Check-ins</h3>${rows.length ? `<ul class="flist">${arr.map((r) => `<li><b>${KIND[r.kind] || r.kind}</b> ${esc(fmtT(r.created_at))}${r.by ? ` · ${esc(r.by)}` : ""} ·
        <a href="${mapUrl(r.lat, r.lng)}" target="_blank" rel="noopener">${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}</a>${r.accuracy_m != null ? ` <small>±${esc(r.accuracy_m)} m</small>` : ""}
        ${r.photo_path ? ` · <button class="link" data-photo="${esc(r.photo_path)}">photo</button>` : ""} <small>(${r.mode === "tracking" ? "tracking" : "geo-tag"})</small></li>`).join("")}</ul>
      ${pts.length ? `<details><summary>${pts.length} tracking point(s), ${esc(fmtT(pts[0].created_at))} – ${esc(fmtT(pts[pts.length - 1].created_at))}</summary><ul class="flist">${pts.map((r) => `<li>${esc(fmtT(r.created_at))} · <a href="${mapUrl(r.lat, r.lng)}" target="_blank" rel="noopener">${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}</a></li>`).join("")}</ul></details>` : ""}`
    : `<p class="s">No check-in yet.</p>`}</div>`;
  box.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = async () => { try { await openStoredFile(BUCKET, b.dataset.photo, "ob-photo.jpg"); } catch (e) { toast(e.message, true); } }));
}

// ---------- team official business (filed by a supervisor / manager for their crew) ----------
const TSTAT = { pending: ["With manager", "wait"], approved: ["Approved · filed with HR", "ok"], rejected: ["Rejected", "bad"], cancelled: ["Cancelled", "mute"] };
const OTSTAT = { pending: "waiting for approval", approved: "approved · enter actual hours", confirming: "superior to confirm hours", head_check: "head to approve hours", hr_check: "HR biometric check", filed: "filed for payroll", rejected: "rejected", cancelled: "cancelled" };
const fmtDay = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const t12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const PURPOSES = ["Site installation", "Site measurement", "Client meeting", "Delivery and installation", "Repair / after-sales"];

export function teamCard(r, esc, actions = "") {
  const [st, k] = TSTAT[r.status] || [r.status, "mute"];
  const live = r.people.filter((p) => p.status === "active"), gone = r.people.filter((p) => p.status !== "active");
  const route = r.route.map((s) => `<li><b>${s.stage === "filer" ? "Filed" : "Manager"}</b> · ${esc(s.name)} — ${esc(s.status)}${s.acted_mode === "delegate" ? " (as delegate)" : s.acted_mode === "hr" ? " (HR)" : ""}${s.note ? `<br><small>${esc(s.note)}</small>` : ""}</li>`).join("");
  return `<div class="card obt" data-tid="${esc(r.id)}"><div class="between"><b>📍 ${esc(r.destination)}</b><span class="chip ${k}">${st}</span></div>
    <div class="s">${esc(r.start_date === r.end_date ? fmtDay(r.start_date) : fmtDay(r.start_date) + " – " + fmtDay(r.end_date))}${r.time_out || r.time_in ? ` · out ${esc(t12(r.time_out) || "–")}, back ${esc(t12(r.time_in) || "–")}` : ""}${r.filed_late ? ' · <span class="warnt">filed after the start</span>' : ""}</div>
    <div class="s">${esc(r.purpose)}</div>
    <div class="s">Team (${live.length}): ${live.map((p) => esc(p.name)).join(", ")}</div>
    ${gone.length ? `<div class="s">Removed: ${gone.map((p) => `${esc(p.name)}${p.removed_note ? ` (${esc(p.removed_note)})` : ""}`).join(", ")}</div>` : ""}
    ${r.ot ? `<div class="s">🕐 Overtime ${esc(fmtDay(r.ot.work_date))} ${esc(t12(r.ot.start))} – ${esc(t12(r.ot.end))}: ${esc(OTSTAT[r.ot.status] || r.ot.status)} · <a href="#/ot">open Overtime</a></div>` : ""}
    <div class="s">Filed by ${esc(r.filed_by_name)}${r.closed_note ? ` · <i>“${esc(r.closed_note)}”</i>` : ""}${r.arrived_at ? ` · arrived ${esc(fmtT(r.arrived_at))}` : ""}</div>
    <details><summary class="s">Approval &amp; check-ins</summary><ol class="otroute">${route}<li>HR files it (record)</li></ol><div data-tcheck><button class="link" data-tshow>Show check-ins</button></div></details>
    ${actions}</div>`;
}

function approveBox(r, esc) {
  const live = r.people.filter((p) => p.status === "active");
  return `<div class="otact">${live.length > 1 ? `<p class="s">Untick anyone who should not be on this OB (needs a note):</p>${live.map((p) => `<label class="check"><input type="checkbox" name="keep" value="${esc(p.id)}" checked><span>${esc(p.name)}</span></label>`).join("")}` : ""}
    <label><span>Note <span class="opt">(optional)</span></span><textarea name="note" rows="2" maxlength="500" placeholder="Reason if rejecting or removing someone"></textarea></label>
    <div class="eerr"></div><div class="btns"><button class="btn primary" data-tact="approve">Approve &amp; sign</button><button class="btn danger" data-tact="reject">Reject &amp; sign</button></div></div>`;
}

function teamForm(form, esc) {
  const t = manilaToday();
  return `<form class="form card" id="tobform"><h3>Team official business</h3>
    <p class="s">For a crew going out together: site installation, measurement, client meetings. Your filing counts as your approval: a supervisor's goes to their manager, a manager's goes straight to HR. People without a login can be on it.</p>
    <fieldset class="fs"><legend>Who is going</legend><div class="otpeople">${(form.people || []).map((p) => `<label class="check"><input type="checkbox" name="temp" value="${esc(p.id)}"${p.me ? " checked" : ""}><span>${esc(p.name)}${p.me ? " (me)" : ""}${p.dept ? ` <small>${esc(p.dept)}</small>` : ""}</span></label>`).join("")}</div></fieldset>
    <label>Where (company / site / address)<input name="dest" maxlength="300" required placeholder="e.g. J Tower, Ortigas — 12th floor pantry"></label>
    <label>Purpose<input name="purpose" maxlength="1000" required list="obpurposes" placeholder="e.g. Site installation of kitchen cabinets"><datalist id="obpurposes">${PURPOSES.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
    <div class="two"><label>From<input type="date" name="start" value="${t}" required></label><label>To<input type="date" name="end" value="${t}" required></label></div>
    <div class="two"><label>Time out <span class="opt">(expected)</span><input type="time" name="tout"></label><label>Time back <span class="opt">(expected)</span><input type="time" name="tin"></label></div>
    <label class="check"><input type="radio" name="tmode" value="geotag" checked><span><b>Geo-tag</b> — one arrival photo with the location</span></label>
    <label class="check"><input type="radio" name="tmode" value="tracking"><span><b>Tracking</b> — arrival photo, then the location is recorded while the app is open</span></label>
    <label class="check"><input type="checkbox" name="withot"><span>Also file <b>overtime</b> for this job (same people)</span></label>
    <div id="tobot" hidden class="fs"><div class="two"><label>Overtime date<input type="date" name="otdate" value="${t}"></label><span></span></div>
      <div class="two"><label>Overtime start<input type="time" name="otstart"></label><label>Overtime end<input type="time" name="otend"></label></div>
      <p class="s">The overtime goes through its own approval (superior, and head / Managing Director on rest days and holidays). Enter the actual hours on the Overtime page after the work.</p></div>
    <div class="eerr"></div><button class="btn primary block" type="submit">Sign &amp; submit</button>
    <p class="s" style="text-align:center">Your fingerprint, face or device PIN is your signature.</p></form>`;
}

function wireTeam(el, ctx) {
  const { rpc, toast, errBox, state, reload } = ctx;
  const tb = el.querySelector("[data-teamform]"), box = el.querySelector("#teamform");
  if (tb) tb.onclick = () => { box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const f = el.querySelector("#tobform");
  if (f) {
    const ot = f.querySelector("#tobot");
    f.withot.onchange = () => { ot.hidden = !f.withot.checked; if (f.withot.checked && !f.otdate.value) f.otdate.value = f.start.value; };
    f.start.onchange = () => { if (!f.end.value || f.end.value < f.start.value) f.end.value = f.start.value; f.otdate.value = f.start.value; };
    f.onsubmit = async (ev) => {
      ev.preventDefault(); const err = f.querySelector(".eerr"), btn = f.querySelector("button[type=submit]"); err.innerHTML = "";
      const emps = [...f.querySelectorAll("[name=temp]:checked")].map((x) => x.value);
      if (!emps.length) { err.innerHTML = errBox(new Error("Tick the people going.")); return; }
      if (f.withot.checked && (!f.otstart.value || !f.otend.value)) { err.innerHTML = errBox(new Error("Fill the overtime start and end, or untick overtime.")); return; }
      btn.disabled = true; btn.textContent = "Signing…";
      try {
        const sid = await sign("SUBMIT", state.me?.full_name);
        await rpc("iaf_obt_file", { p: { employees: emps, destination: f.dest.value, purpose: f.purpose.value, start: f.start.value, end: f.end.value || f.start.value,
          time_out: f.tout.value || null, time_in: f.tin.value || null, mode: (f.querySelector("[name=tmode]:checked") || {}).value || "geotag", signature_id: sid,
          ...(f.withot.checked ? { ot: { work_date: f.otdate.value, start: f.otstart.value, end: f.otend.value } } : {}) } });
        toast(f.withot.checked ? "Team OB and overtime submitted ✔" : "Team OB submitted ✔"); reload();
      } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; btn.textContent = "Sign & submit"; }
    };
  }
  el.querySelectorAll("[data-tid]").forEach((card) => {
    const id = card.dataset.tid, err = card.querySelector(".eerr");
    const show = card.querySelector("[data-tshow]");
    if (show) show.onclick = () => renderObCheckins(card.querySelector("[data-tcheck]"), id, ctx);
    card.querySelectorAll("[data-tact]").forEach((b) => (b.onclick = async () => {
      const yes = b.dataset.tact === "approve", note = (card.querySelector("textarea[name=note]")?.value || "").trim() || null;
      const remove = [...card.querySelectorAll("[name=keep]")].filter((x) => !x.checked).map((x) => x.value);
      if (err) err.innerHTML = ""; b.disabled = true; const label = b.textContent; b.textContent = "Signing…";
      try { const sid = await sign(yes ? "APPROVE" : "REJECT", state.me?.full_name);
        await rpc("iaf_obt_act", { p_id: id, p_action: b.dataset.tact, p_note: note, p_remove: yes && remove.length ? remove : null, p_signature: sid });
        toast(yes ? "Approved ✔" : "Rejected ✔"); reload();
      } catch (e) { if (err) err.innerHTML = errBox(e); b.disabled = false; b.textContent = label; }
    }));
    const c = card.querySelector("[data-tcancel]");
    if (c) c.onclick = async () => { const why = prompt("Cancel this team OB (and its overtime, if any)? Reason (optional):"); if (why === null) return;
      c.disabled = true; try { await rpc("iaf_obt_cancel", { p_id: id, p_note: why || null }); toast("Cancelled ✔"); reload(); } catch (e) { if (err) err.innerHTML = errBox(e); c.disabled = false; } };
  });
}

// ---------- HR: team OB records per company and month, CSV for Excel ----------
async function renderTeamHr(body, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  let cos; try { cos = await rpc("iaf_my_companies"); } catch (e) { body.innerHTML = errBox(e); return; }
  if (!cos.length) { body.innerHTML = `<div class="empty">No company access.</div>`; return; }
  const st = state.obHr ||= { co: (cos.find((c) => c.is_home) || cos[0]).id, month: manilaToday().slice(0, 7) };
  const [y, m] = st.month.split("-").map(Number), from = `${st.month}-01`, to = `${st.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const cur = cos.find((c) => c.id === st.co) || cos[0];
  body.innerHTML = `<div class="cotabs">${cos.map((c) => `<button class="cotab${c.id === st.co ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <div class="card"><div class="between"><p class="s">Team official business filed by supervisors and managers for their crews. Individual OBs are under Leave (type Official Business).</p>
    <label>Month<input type="month" id="obm" value="${esc(st.month)}"></label><button class="btn" id="obcsv" style="white-space:nowrap">⬇ Excel CSV</button></div></div><div id="oblist"><div class="empty loading">Loading…</div></div>`;
  body.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; renderTeamHr(body, ctx); }));
  body.querySelector("#obm").onchange = (e) => { if (e.target.value) { st.month = e.target.value; renderTeamHr(body, ctx); } };
  let list = [];
  try { list = await rpc("iaf_obt_list", { p_company: st.co, p_from: from, p_to: to });
    body.querySelector("#oblist").innerHTML = list.length ? list.map((r) => teamCard(r, esc)).join("") : `<div class="empty">No team OB in this month.</div>`;
    wireTeam(body.querySelector("#oblist"), { ...ctx, reload: () => renderTeamHr(body, ctx) });
  } catch (e) { body.querySelector("#oblist").innerHTML = errBox(e); }
  body.querySelector("#obcsv").onclick = () => {
    const rows = list.flatMap((r) => r.people.filter((p) => p.status === "active").map((p) => [p.name, p.dept || "", r.start_date, r.end_date, r.time_out || "", r.time_in || "", r.destination, r.purpose, TSTAT[r.status]?.[0] || r.status, r.filed_by_name, r.arrived_at ? fmtT(r.arrived_at) : ""]));
    if (!rows.length) { toast("No team OB in this month.", true); return; }
    const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [["Name", "Department", "From", "To", "Time out", "Time back", "Where", "Purpose", "Status", "Filed by", "Arrived"], ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = `Team_OB_${cur.short_code}_${st.month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
}
