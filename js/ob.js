// Official Business (OB). Filed on the File leave page (type "Official Business"), approved like leave.
// On the day, on the phone: the employee checks in at the place with a photo stamped with the location and time (geo-tag),
// or also turns on tracking (location points every few minutes while the app is open). Approvers, managers above and HR
// see the check-ins on the request.
import { storageUpload, openStoredFile, rest } from "./api.js";

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
export async function renderOb(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  let today, mine;
  try {
    [today, mine] = await Promise.all([rpc("iaf_ob_today"),
      rest(`leave_requests?requester_id=eq.${state.me.id}&select=id,start_date,end_date,status,detail,reason,leave_types!inner(code)&leave_types.code=eq.OB&order=start_date.desc&limit=20`).catch(() => [])]);
  } catch (e) { el.innerHTML = errBox(e); return; }
  today.forEach((o) => { if (modes[o.id]) o.mode = modes[o.id]; });
  const reload = () => renderOb(el, ctx);
  const card = (o) => {
    const tracking = trk.watch != null && trk.req === o.id;
    return `<div class="card obcard" data-ob="${esc(o.id)}"><div class="between"><h3>📍 ${esc(o.destination || "Official business")}</h3><span class="chip ${o.status === "APPROVED" || o.status === "FILED" ? "ok" : "wait"}">${o.status === "APPROVED" || o.status === "FILED" ? "Approved" : "Waiting for approval"}</span></div>
      <p class="s">${esc(o.purpose || "")}${o.time_out || o.time_in ? ` · out ${esc(o.time_out || "–")}, back ${esc(o.time_in || "–")}` : ""}</p>
      <div class="cotabs obmode"><button class="cotab${o.mode !== "tracking" ? " on" : ""}" data-mode="geotag">Geo-tag</button><button class="cotab${o.mode === "tracking" ? " on" : ""}" data-mode="tracking">Tracking</button></div>
      <p class="s">${o.mode === "tracking" ? "Take the arrival photo, then keep the app open: your location is recorded every few minutes until you check out." : "Take one photo when you arrive. The location and time are stamped on it."}</p>
      ${o.arrived_at ? `<div class="alert ok">✔ Arrived ${esc(fmtT(o.arrived_at))}${o.points_today ? ` · ${o.points_today} location point(s)` : ""}${o.departed_at ? ` · left ${esc(fmtT(o.departed_at))}` : ""}</div>` : ""}
      ${tracking ? `<div class="alert warn">Tracking is on. Keep this app open. Points sent: <b>${trk.sent}</b>${trk.err ? ` · ${esc(trk.err)}` : ""}</div>` : ""}
      <div class="btns">${!o.arrived_at ? `<button class="btn primary" data-arrive>📷 I'm here — take photo</button>` : `<button class="btn" data-arrive>📷 Another photo</button>`}
        ${o.mode === "tracking" && o.arrived_at && !o.departed_at ? (tracking ? `<button class="btn" data-stop>Stop tracking</button>` : `<button class="btn" data-track>Turn on tracking</button>`) : ""}
        ${o.arrived_at && !o.departed_at ? `<button class="btn" data-depart>I'm leaving — check out</button>` : ""}</div><div class="eerr"></div></div>`;
  };
  el.innerHTML = `${today.length ? today.map(card).join("") : `<div class="card"><p>No official business today.</p></div>`}
    <a class="btn primary block" href="#/file?type=OB">+ File an official business</a>
    <h3>My official business</h3>${mine.length ? `<div class="list">${mine.map((r) => `<a class="row" href="#/requests/${esc(r.id)}"><div class="grow"><div class="t">${esc(r.detail?.destination || "Official business")}</div>
      <div class="s">${esc(r.start_date === r.end_date ? r.start_date : r.start_date + " – " + r.end_date)} · ${esc(r.reason || "")}</div></div><span class="chip ${r.status === "APPROVED" || r.status === "FILED" ? "ok" : r.status === "REJECTED" || r.status === "CANCELLED" ? "mute" : "wait"}">${esc(r.status.replace(/_/g, " ").toLowerCase())}</span></a>`).join("")}</div>` : `<div class="empty small">None yet.</div>`}`;

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
        const blob = await stampPhoto(file, [`Official Business · ${state.me.full_name}`, o.destination || "", `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}  (±${pos.acc} m)`, at.toLocaleString("en-PH")]);
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
  box.innerHTML = `<div class="card"><h3>📍 Check-ins</h3>${rows.length ? `<ul class="flist">${arr.map((r) => `<li><b>${KIND[r.kind] || r.kind}</b> ${esc(fmtT(r.created_at))} ·
        <a href="${mapUrl(r.lat, r.lng)}" target="_blank" rel="noopener">${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}</a>${r.accuracy_m != null ? ` <small>±${esc(r.accuracy_m)} m</small>` : ""}
        ${r.photo_path ? ` · <button class="link" data-photo="${esc(r.photo_path)}">photo</button>` : ""} <small>(${r.mode === "tracking" ? "tracking" : "geo-tag"})</small></li>`).join("")}</ul>
      ${pts.length ? `<details><summary>${pts.length} tracking point(s), ${esc(fmtT(pts[0].created_at))} – ${esc(fmtT(pts[pts.length - 1].created_at))}</summary><ul class="flist">${pts.map((r) => `<li>${esc(fmtT(r.created_at))} · <a href="${mapUrl(r.lat, r.lng)}" target="_blank" rel="noopener">${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}</a></li>`).join("")}</ul></details>` : ""}`
    : `<p class="s">No check-in yet.</p>`}</div>`;
  box.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = async () => { try { await openStoredFile(BUCKET, b.dataset.photo, "ob-photo.jpg"); } catch (e) { toast(e.message, true); } }));
}
