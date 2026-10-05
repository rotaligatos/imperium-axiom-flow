import { buildAtrfPdf, fmtDate } from "./atrf.js";
import { renderAdmin } from "./admin.js";
import { renderEmployees } from "./employees.js";
import { renderOrg } from "./org.js";
import { renderSchedules, dayLine } from "./schedules.js";
import { mountPad, pngToPdfImage } from "./sigpad.js";
import { sign, registerDevice, myDevices, canSign } from "./sign.js";
import { isConfigured, getSession, userId, signIn, signOut, rest, rpc } from "./api.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const YEAR = new Date().getFullYear();

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => ymd(new Date());
const fmtD = (s) => pd(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtRange = (a, b) => (a === b ? fmtD(a) : `${fmtD(a)} – ${fmtD(b)}`);
const spanDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000) + 1;
const num = (n) => { const x = Number(n); return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ""); };
const STATUS = {
  SUBMITTED: ["Submitted", "wait"], PENDING_SUPERVISOR: ["With Supervisor", "wait"], PENDING_MANAGER: ["With Manager", "wait"],
  PENDING_HR_MANAGER: ["With HR Manager", "wait"], COUNTERED: ["Counter-proposal", "warn"], APPROVED: ["Approved", "ok"],
  REJECTED: ["Rejected", "bad"], FILED: ["Filed", "ok"], CANCELLED: ["Cancelled", "mute"] };
const CANCELLABLE = ["SUBMITTED", "PENDING_SUPERVISOR", "PENDING_MANAGER", "PENDING_HR_MANAGER", "COUNTERED"];
const PENDING_FOR_APPROVER = ["PENDING_SUPERVISOR", "PENDING_MANAGER", "PENDING_HR_MANAGER"];
const chip = (st) => { const [t, k] = STATUS[st] || [st, "mute"]; return `<span class="chip ${k}">${esc(t)}</span>`; };
const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

let toastTimer;
function toast(msg, bad = false) {
  $toast.textContent = msg; $toast.className = "show" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ($toast.className = ""), 4200);
}
const state = { me: null, types: null, pending: 0, isApprover: false, isAdmin: false, canPeople: false, empCompany: null, empQuery: "", orgCompany: null, orgDept: "", orgSel: null };
let navToken = 0;

// ---------- data ----------
async function loadMe() {
  const rows = await rest(`users?id=eq.${userId()}&select=id,full_name,company_id,dept_id,manager_id,status`);
  if (!rows.length) throw new Error("Your login is not linked to an employee record yet. Please contact HR.");
  state.me = rows[0];
  state.isAdmin = (await rest("iaf_admins?select=user_id").catch(() => [])).length > 0;
  const hr = (await rest("iaf_hr_staff?select=user_id").catch(() => [])).length > 0;
  state.canPeople = state.isAdmin || hr;            // Employees page: administrators and people marked as HR staff
}
async function loadTypes() {
  if (!state.types) state.types = await rest("leave_types?is_active=eq.true&select=id,code,display_name,tracks_balance&order=display_name");
  return state.types;
}
async function refreshBadge() {
  try {
    const [p, a] = await Promise.all([
      rest(`leave_requests?current_approver_id=eq.${userId()}&status=in.(${PENDING_FOR_APPROVER.join(",")})&select=id`),
      rest(`leave_approvals?approver_id=eq.${userId()}&select=id&limit=1`) ]);
    state.pending = p.length; state.isApprover = p.length > 0 || a.length > 0;
    document.querySelectorAll("[data-badge]").forEach((el) => { el.textContent = state.pending; el.hidden = !state.pending; });
    document.querySelectorAll("[data-approver-nav]").forEach((el) => { el.hidden = !state.isApprover; });
  } catch { /* badge is best-effort */ }
}

// ---------- shell ----------
function shell(active, title, body, wide = false) {
  const nav = [["#/", "Home", "🏠", "home"], ["#/file", "File leave", "➕", "file"], ["#/requests", "My requests", "📄", "requests"],
    ["#/approvals", "Approvals", "✅", "approvals"], ["#/calendar", "Calendar", "📅", "calendar"], ...(state.canPeople ? [["#/employees", "Employees", "👥", "employees"], ["#/org", "Org chart", "🗂️", "org"], ["#/schedules", "Schedules", "🕒", "schedules"]] : []), ...(state.isAdmin ? [["#/admin", "Admin", "⚙️", "admin"]] : [])];
  const links = nav.map(([h, t, ic, k]) => `<a href="${h}" class="${active === k ? "on" : ""}" ${k === "approvals" ? 'data-approver-nav ' + (state.isApprover ? "" : "hidden") : ""}>
      <span class="ic" aria-hidden="true">${ic}</span><span>${t}</span>${k === "approvals" ? `<b class="badge" data-badge ${state.pending ? "" : "hidden"}>${state.pending}</b>` : ""}</a>`).join("");
  $app.innerHTML = `<div class="layout">
    <aside class="side"><div class="brand"><img class="logo" src="icons/icon-192.png" alt="IAF"><div><strong>Imperium Axiom Flow</strong><small>HR · Leave</small></div></div>
      <nav>${links}</nav>
      <div class="me"><div class="av">${esc(initials(state.me?.full_name))}</div><div class="who">${esc(state.me?.full_name)}</div>
        <button class="link" data-act="signout">Sign out</button></div></aside>
    <main><header class="top"><h1>${esc(title)}</h1><button class="link only-mobile" data-act="signout">Sign out</button></header>
      <div class="content${wide ? " wide" : ""}">${body}</div></main>
    <nav class="tabs">${links}</nav></div>`;
}
const loading = (t = "Loading…") => `<div class="empty">${esc(t)}</div>`;
const errBox = (e) => `<div class="alert bad">${esc(e.message || e)}</div>`;

// ---------- views ----------
async function viewLogin() {
  if (!isConfigured()) {
    $app.innerHTML = `<div class="auth"><div class="card"><img class="logo big" src="icons/icon-192.png" alt="IAF"><h1>Setup needed</h1>
      <p>The app has no database key yet. Open <code>config.js</code> and paste the project's public <b>anon / publishable</b> key into <code>SUPABASE_ANON_KEY</code>. Never use the secret/service_role key.</p></div></div>`;
    return;
  }
  $app.innerHTML = `<div class="auth"><form class="card" id="login" autocomplete="on">
    <img class="logo big" src="icons/icon-192.png" alt="IAF"><h1>Imperium Axiom Flow</h1><p class="sub">Sign in with your company account</p>
    <label>Email<input name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <div id="lerr"></div><button class="btn primary block" type="submit">Sign in</button></form></div>`;
  document.getElementById("login").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target; const b = f.querySelector("button"); b.disabled = true; b.textContent = "Signing in…";
    try { await signIn(f.email.value.trim(), f.password.value); await bootSignedIn(); }
    catch (e) { document.getElementById("lerr").innerHTML = errBox(e); b.disabled = false; b.textContent = "Sign in"; }
  });
}

async function viewHome(tok) {
  shell("home", `Hello, ${(state.me.full_name || "").split(" ")[0]}`, loading());
  const el = document.querySelector(".content");
  try {
    const [bal, reqs, devs, myImg, mySch] = await Promise.all([
      rest(`vw_leave_balances_live?user_id=eq.${userId()}&year=eq.${YEAR}&select=leave_type_code,total_allotment,used,remaining`),
      rest(`leave_requests?requester_id=eq.${userId()}&select=id,start_date,end_date,days_requested,status,leave_types(code,display_name)&order=created_at.desc&limit=5`),
      myDevices().catch(() => []),
      rest(`iaf_signature_images?user_id=eq.${userId()}&select=png_base64`).catch(() => []),
      rpc("iaf_my_schedule", { p_days: 7 }).catch(() => null) ]);
    if (tok !== navToken) return;
    const cards = ["VL", "SL"].map((c) => {
      const b = bal.find((x) => x.leave_type_code === c);
      const name = c === "VL" ? "Vacation Leave" : "Sick Leave";
      if (!b) return `<div class="bal"><div class="bn">${name}</div><div class="bv">—</div><div class="bs">No ${YEAR} balance set up yet</div></div>`;
      const pct = Number(b.total_allotment) ? Math.max(0, Math.min(100, (Number(b.remaining) / Number(b.total_allotment)) * 100)) : 0;
      return `<div class="bal"><div class="bn">${name}</div><div class="bv">${num(b.remaining)}<small> days left</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div><div class="bs">${num(b.used)} used of ${num(b.total_allotment)} in ${YEAR}</div></div>`; }).join("");
    const recent = reqs.length ? reqs.map((r) => reqRow(r)).join("") : `<div class="empty">No requests yet.</div>`;
    const schedCard = mySch && mySch.linked && mySch.days.length ? `<div class="card mysched"><h3>My schedule</h3>${mySch.days.map((d, i) => `<div class="row${i === 0 ? " today" : ""}${d.rest ? " rest" : ""}"><span>${i === 0 ? "Today" : new Date(d.date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</span><span>${esc(dayLine(d))}</span></div>`).join("")}${mySch.days[0].schedule ? `<p class="s">${esc(mySch.days[0].schedule)}</p>` : ""}</div>` : "";
    el.innerHTML = `${schedCard}<div class="bals">${cards}</div>
      <a class="btn primary block" href="#/file">➕ File a leave</a>
      ${state.pending ? `<a class="notice" href="#/approvals"><b>${state.pending}</b> request${state.pending > 1 ? "s" : ""} waiting for your decision →</a>` : ""}
      <h2>Recent requests</h2><div class="list">${recent}</div>
      ${reqs.length ? `<a class="link" href="#/requests">See all →</a>` : ""}
      <div class="card"><h3>My signature</h3>
        <p class="s">${devs.length ? `✔ Device set up (${esc(devs.map((d) => d.label || "Device").join(", "))}). You sign with your fingerprint, face or device PIN.`
          : "Step 1 — set up this device so your fingerprint, face or PIN can be your signature."}</p>
        ${devs.length ? `<button class="link" data-act="reg-device">Add another device</button>` : `<button class="btn block" data-act="reg-device">Set up this device</button>`}
        <p class="s" style="margin-top:14px">${myImg[0] ? "✔ Your drawn signature (shown on the printed form):" : "Step 2 — draw your signature. It appears on your leave forms once you file or approve."}</p>
        ${myImg[0] ? `<div class="sigprev"><img alt="Your signature" src="data:image/png;base64,${esc(myImg[0].png_base64)}"></div>` : ""}
        <div id="padhost"></div>
        <button class="btn block" data-act="draw-sig">${myImg[0] ? "Change signature" : "Draw my signature"}</button></div>`;
    el.querySelectorAll("[data-act=reg-device]").forEach((rb) => (rb.onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true;
      try { await registerDevice(state.me?.full_name); toast("This device is set up ✔"); route(); } catch (e) { toast(e.message || "Could not set up this device", true); b.disabled = false; } }));
    el.querySelector("[data-act=draw-sig]").onclick = (ev) => { ev.currentTarget.hidden = true;
      mountPad(el.querySelector("#padhost"), { onCancel: () => route(), onSave: async (png) => { await rpc("iaf_signature_image_save", { p_png_base64: png }); toast("Signature saved ✔"); route(); } }); };
  } catch (e) { el.innerHTML = errBox(e); }
}

function reqRow(r, base = "#/requests/", activeId = null) {
  return `<a class="row${r.id === activeId ? " on" : ""}" href="${base}${esc(r.id)}"><div class="grow"><div class="t">${esc(r.leave_types?.display_name || "Leave")}${r.requester ? ` · ${esc(r.requester.full_name)}` : ""}</div>
    <div class="s">${esc(fmtRange(r.start_date, r.end_date))} · ${num(r.days_requested)} day${Number(r.days_requested) === 1 ? "" : "s"}</div></div>${chip(r.status)}</a>`;
}

// (viewRequests / viewApprovals are now viewSplit, below)

async function viewFile(tok) {
  shell("file", "File a leave", loading());
  const el = document.querySelector(".content");
  try {
    const types = await loadTypes(); if (tok !== navToken) return;
    const order = ["VL", "SL"]; const sorted = [...types].sort((a, b) => (order.indexOf(a.code) + 1 || 99) - (order.indexOf(b.code) + 1 || 99) || a.display_name.localeCompare(b.display_name));
    const t = todayStr();
    el.innerHTML = `<form id="ff" class="form">
      <label>Leave type<select name="type" required>${sorted.map((x) => `<option value="${esc(x.code)}">${esc(x.display_name)}</option>`).join("")}</select></label>
      <div class="two"><label>From<input type="date" name="start" value="${t}" required></label><label>To<input type="date" name="end" value="${t}" required></label></div>
      <label>Number of days<input type="number" name="days" min="0.5" step="0.5" inputmode="decimal" value="1" required>
        <small id="dayhint"></small></label>
      <label><span>Reason</span><textarea name="reason" rows="3" maxlength="500" minlength="3" required placeholder="Tell your approver why you are filing this leave"></textarea></label>
      <label class="check" id="covrow" hidden><input type="checkbox" name="cov"><span>Use my Vacation Leave to cover an exhausted Sick Leave<small>This needs extra approval from the HR Manager.</small></span></label>
      <div id="ferr"></div><button class="btn primary block" type="submit">Sign &amp; submit</button><p class="s" style="text-align:center">Your fingerprint, face or device PIN is your signature on the form.</p>
      <p class="fine">Your request goes to your approver automatically. You'll see its progress under “My requests”.</p></form>`;
    const f = document.getElementById("ff");
    let touchedDays = false;
    const sync = () => {
      const s = f.start.value, e = f.end.value; const hint = document.getElementById("dayhint");
      if (s && e && e >= s) { const span = spanDays(s, e); f.days.max = span; if (!touchedDays) f.days.value = span;
        hint.textContent = `${span} calendar day${span > 1 ? "s" : ""} selected — lower this to skip weekends/rest days, or use 0.5 for a half day.`; }
      else hint.textContent = "“To” must be on or after “From”.";
      document.getElementById("covrow").hidden = f.type.value !== "VL";
      if (f.type.value !== "VL") f.cov.checked = false;
    };
    f.days.addEventListener("input", () => (touchedDays = true));
    ["start", "end", "type"].forEach((n) => f[n].addEventListener("change", () => { if (n !== "type") touchedDays = false; if (n === "start" && f.end.value < f.start.value) f.end.value = f.start.value; sync(); }));
    sync();
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Submitting…";
      document.getElementById("ferr").innerHTML = "";
      try {
        if (f.reason.value.trim().length < 3) throw new Error("Please enter a reason for your leave.");
        btn.textContent = "Waiting for your fingerprint / face / PIN…";
        const sig = await sign("SUBMIT", state.me?.full_name);
        btn.textContent = "Submitting…";
        const id = await rpc("iaf_leave_submit", { p_leave_type_code: f.type.value, p_start_date: f.start.value, p_end_date: f.end.value,
          p_days: Number(f.days.value), p_reason: f.reason.value.trim(), p_is_wfh: f.type.value === "WFH", p_is_vl_covering_sl: !!f.cov.checked, p_signature_id: sig });
        toast("Leave submitted ✔"); location.hash = `#/requests/${id}`;
      } catch (e) { document.getElementById("ferr").innerHTML = errBox(e); btn.disabled = false; btn.textContent = "Sign & submit"; }
    });
  } catch (e) { el.innerHTML = errBox(e); }
}

const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };

// List + detail. Phone: list OR detail (with a Back link). Desktop: side by side.
async function viewSplit(tok, mode, id) {
  const isAp = mode === "approvals";
  shell(mode, isAp ? "Approvals" : "My requests",
    `<div class="split ${id ? "has-detail" : ""}"><section class="pane-list" id="plist">${loading()}</section>
     <section class="pane-detail" id="pdetail">${id ? loading() : `<div class="empty">Select a request to see its details.</div>`}</section></div>`, true);
  const listEl = document.getElementById("plist"), detEl = document.getElementById("pdetail");
  const base = `#/${mode}/`;
  const q = isAp
    ? `leave_requests?current_approver_id=eq.${userId()}&status=in.(${PENDING_FOR_APPROVER.join(",")})&select=id,start_date,end_date,days_requested,status,leave_types(code,display_name),requester:users!requester_id(full_name)&order=created_at`
    : `leave_requests?requester_id=eq.${userId()}&select=id,start_date,end_date,days_requested,status,leave_types(code,display_name)&order=created_at.desc&limit=100`;
  const listP = rest(q).then((rows) => {
    if (tok !== navToken) return;
    if (isAp) { state.pending = rows.length; refreshBadge(); }
    listEl.innerHTML = rows.length ? `<div class="list">${rows.map((r) => reqRow(r, base, id)).join("")}</div>`
      : isAp ? `<div class="empty">🎉 Nothing waiting for you.</div>`
      : `<div class="empty">You haven't filed any leave yet.<br><a class="btn primary" href="#/file">File a leave</a></div>`;
  }).catch((e) => { listEl.innerHTML = errBox(e); });
  const detP = id ? renderDetail(detEl, id, tok, mode) : Promise.resolve();
  await Promise.all([listP, detP]);
}

async function renderDetail(el, id, tok, mode) {
  try {
    const [rows, apps] = await Promise.all([
      rest(`leave_requests?id=eq.${encodeURIComponent(id)}&select=*,leave_types(code,display_name),requester:users!requester_id(full_name),approver:users!current_approver_id(full_name)`),
      rest(`leave_approvals?leave_request_id=eq.${encodeURIComponent(id)}&select=*,approver:users!approver_id(full_name)&order=created_at`) ]);
    if (tok !== navToken) return;
    const back = `<a class="back" href="#/${mode}">‹ Back to list</a>`;
    const r = rows[0]; if (!r) { el.innerHTML = back + `<div class="empty">This request isn't available.</div>`; return; }
    const mine = r.requester_id === userId();
    const lastCounter = [...apps].reverse().find((a) => a.action === "COUNTERED");
    let actions = "";
    if (mine && r.status === "COUNTERED" && lastCounter) {
      const pdays = lastCounter.proposed_days ?? spanDays(lastCounter.proposed_start_date, lastCounter.proposed_end_date);
      actions += `<div class="alert warn"><b>${esc(lastCounter.approver?.full_name)}</b> proposed different dates:<br><b>${esc(fmtRange(lastCounter.proposed_start_date, lastCounter.proposed_end_date))}</b> · ${num(pdays)} day(s)
        ${lastCounter.notes ? `<br><i>“${esc(lastCounter.notes)}”</i>` : ""}<br><small>If you accept, it goes through the full approval chain again.</small></div>
        <div class="btns"><button class="btn primary" data-act="accept">Accept &amp; sign</button><button class="btn" data-act="decline">Decline &amp; cancel</button></div>`;
    }
    if (r.current_approver_id === userId() && PENDING_FOR_APPROVER.includes(r.status)) {
      actions += `<div class="card"><h3>Your decision</h3><p class="s">Approving or rejecting asks for your fingerprint, face or device PIN as your signature.</p><label><span>Notes <span class="opt">(optional)</span></span><textarea id="anote" rows="2" maxlength="500"></textarea></label>
        <div class="btns"><button class="btn primary" data-act="approve">Approve &amp; sign</button><button class="btn danger" data-act="reject">Reject &amp; sign</button>
        ${r.status !== "PENDING_HR_MANAGER" ? `<button class="btn" data-act="counter-open">Propose other dates</button>` : ""}</div>
        <form id="cform" hidden class="form"><div class="two"><label>New start date<input type="date" name="s" value="${esc(r.start_date)}" required></label><label>New end date<input type="date" name="e" value="${esc(r.end_date)}" required></label></div>
        <label>Days<input type="number" name="d" min="0.5" step="0.5" inputmode="decimal" value="${esc(num(r.days_requested))}" required><small id="chint"></small></label>
        <label><span>Reason for the change <span class="opt">(optional)</span></span><textarea name="cr" rows="2" maxlength="500" placeholder="e.g. We have a deadline that week"></textarea></label>
        <button class="btn primary block" type="submit">Send counter-proposal</button></form></div>`;
    }
    if (mine && CANCELLABLE.includes(r.status) && r.status !== "COUNTERED") actions += `<button class="btn danger block" data-act="cancel">Cancel this request</button>`;
    const tl = apps.map((a) => `<li><b>${esc(a.approver?.full_name || "Approver")}</b> ${a.action === "APPROVED" ? "approved" : a.action === "REJECTED" ? "rejected" : "proposed other dates"}
      <small>${esc(a.tier.replace("_", " ").toLowerCase())} · ${esc(new Date(a.created_at).toLocaleString())}</small>${a.notes ? `<em>“${esc(a.notes)}”</em>` : ""}</li>`).join("");
    el.innerHTML = back + `<div class="card"><div class="between"><h2 class="nm">${esc(r.leave_types?.display_name)}</h2>${chip(r.status)}</div>
      ${!mine ? `<p class="s">Requested by <b>${esc(r.requester?.full_name)}</b></p>` : ""}
      <dl><dt>Dates</dt><dd>${esc(fmtRange(r.start_date, r.end_date))}</dd><dt>Days</dt><dd>${num(r.days_requested)}</dd>
      ${r.reason ? `<dt>Reason</dt><dd>${esc(r.reason)}</dd>` : ""}
      ${r.is_vl_covering_sl ? `<dt>Note</dt><dd>VL covering exhausted SL (HR Manager approval required)</dd>` : ""}
      ${r.is_unpaid_loa_conversion ? `<dt>Note</dt><dd>Balance ran out — converted to unpaid leave</dd>` : ""}
      ${r.approver && PENDING_FOR_APPROVER.includes(r.status) ? `<dt>Waiting on</dt><dd>${esc(r.approver.full_name)}</dd>` : ""}</dl></div>
      <button class="btn block" data-act="pdf">Download form (PDF)</button>
      ${actions}<h3>History</h3>${tl ? `<ol class="tl">${tl}</ol>` : `<div class="empty small">No decisions yet.</div>`}`;
    el.__apps = apps; wireDetail(el, r);
  } catch (e) { el.innerHTML = errBox(e); }
}

function wireDetail(el, r) {
  const all = () => el.querySelectorAll("button");
  const act = async (fn, msg) => {
    all().forEach((b) => (b.disabled = true));
    try { const out = await fn(); toast(msg(out)); await refreshBadge(); route(); }
    catch (e) { toast(e.message, true); all().forEach((b) => (b.disabled = false)); }
  };
  const note = () => el.querySelector("#anote")?.value.trim() || null;
  el.onclick = (ev) => {
    const b = ev.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act;
    if (a === "approve") act(async () => rpc("iaf_leave_act", { p_request_id: r.id, p_action: "APPROVED", p_notes: note(), p_signature_id: await sign("APPROVE", state.me?.full_name) }), (s) => `Approved & signed → ${(STATUS[s] || [s])[0]}`);
    if (a === "reject") { if (confirm("Reject this request?")) act(async () => rpc("iaf_leave_act", { p_request_id: r.id, p_action: "REJECTED", p_notes: note(), p_signature_id: await sign("REJECT", state.me?.full_name) }), () => "Request rejected"); }
    if (a === "counter-open") el.querySelector("#cform").hidden = false;
    if (a === "accept") act(async () => rpc("iaf_leave_respond_counter", { p_request_id: r.id, p_accept: true, p_signature_id: await sign("ACCEPT", state.me?.full_name) }), () => "Accepted & signed — sent back for approval");
    if (a === "decline") { if (confirm("Decline the proposal? This cancels your request.")) act(() => rpc("iaf_leave_respond_counter", { p_request_id: r.id, p_accept: false }), () => "Request cancelled"); }
    if (a === "pdf") downloadForm(r, el.__apps || [], b);
    if (a === "cancel") { if (confirm("Cancel this request?")) act(() => rpc("iaf_leave_cancel", { p_request_id: r.id }), () => "Request cancelled"); }
  };
  const f = el.querySelector("#cform");
  if (f) {
    // Keep the original length: picking a new start moves the end date with it.
    const origSpan = spanDays(r.start_date, r.end_date), origDays = Number(r.days_requested);
    const hint = el.querySelector("#chint");
    const fit = () => { const span = f.e.value >= f.s.value ? spanDays(f.s.value, f.e.value) : 0;
      f.d.max = span || ""; if (span && Number(f.d.value) > span) f.d.value = span;
      hint.textContent = span ? `${span} calendar day${span > 1 ? "s" : ""} between these dates.` : "End date must be on or after the start date."; };
    f.s.addEventListener("change", () => { if (!f.s.value) return; f.e.value = addDays(f.s.value, origSpan - 1); f.d.value = origDays; fit(); });
    f.e.addEventListener("change", () => { if (f.e.value < f.s.value) f.e.value = f.s.value; fit(); });
    fit();
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      act(() => rpc("iaf_leave_act", { p_request_id: r.id, p_action: "COUNTERED", p_notes: f.cr.value.trim() || note(), p_proposed_start: f.s.value, p_proposed_end: f.e.value, p_proposed_days: Number(f.d.value) }), () => "Counter-proposal sent");
    });
  }
}

let calMonth = null;
async function viewCalendar(tok) {
  shell("calendar", "Who's out", loading(), true);
  const el = document.querySelector(".content");
  const now = new Date(); calMonth ||= new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const first = calMonth, last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const rows = await rest(`vw_leave_calendar?start_date=lte.${ymd(last)}&end_date=gte.${ymd(first)}&select=full_name,leave_type_code,start_date,end_date,is_wfh&order=start_date`);
    if (tok !== navToken) return;
    const byDay = {};
    rows.forEach((r) => { for (let d = new Date(Math.max(pd(r.start_date), first)); d <= Math.min(pd(r.end_date), last); d.setDate(d.getDate() + 1)) (byDay[ymd(d)] ||= []).push(r); });
    const lead = first.getDay(); let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="dow">${d}</div>`).join("") + '<div></div>'.repeat(lead);
    for (let i = 1; i <= last.getDate(); i++) { const k = ymd(new Date(first.getFullYear(), first.getMonth(), i)); const n = byDay[k]?.length || 0;
      cells += `<button class="day ${n ? "has" : ""} ${k === todayStr() ? "today" : ""}" data-day="${k}">${i}${n ? `<i>${n}</i>` : ""}</button>`; }
    el.innerHTML = `<div class="between mhead"><button class="btn sm" data-m="-1" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><button class="btn sm" data-m="1" aria-label="Next month">›</button></div>
      <div class="calwrap"><div class="calmain"><div class="grid">${cells}</div></div><aside id="dayinfo" class="list calside"></aside></div>`;
    const show = (k) => { document.getElementById("dayinfo").innerHTML = (byDay[k] || []).length
      ? `<h3>${esc(fmtD(k))}</h3>` + byDay[k].map((r) => `<div class="row"><div class="av sm">${esc(initials(r.full_name))}</div><div class="grow"><div class="t">${esc(r.full_name)}</div><div class="s">${esc(r.leave_type_code)}${r.is_wfh ? " · WFH" : ""} · ${esc(fmtRange(r.start_date, r.end_date))}</div></div></div>`).join("")
      : `<h3>${esc(fmtD(k))}</h3><div class="empty small">Nobody is out.</div>`; };
    show(todayStr().slice(0, 7) === ymd(first).slice(0, 7) ? todayStr() : ymd(first));
    el.onclick = (ev) => { const m = ev.target.closest("[data-m]"); if (m) { calMonth = new Date(first.getFullYear(), first.getMonth() + Number(m.dataset.m), 1); route(); return; }
      const d = ev.target.closest("[data-day]"); if (d) show(d.dataset.day); };
  } catch (e) { el.innerHTML = errBox(e); }
}

// ---------- routing / boot ----------
async function viewAdminPage(tok) {
  if (!state.isAdmin) { location.replace("#/"); return; }
  shell("admin", "People & access", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderAdmin(el, { rest, rpc, esc, toast, errBox, userId });
}
async function viewEmployeesPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("employees", "Employees", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderEmployees(el, { rpc, esc, toast, errBox, state });
}
async function viewSchedulesPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("schedules", "Work schedules", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderSchedules(el, { rpc, esc, toast, errBox, state });
}
async function viewOrgPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("org", "Org chart", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderOrg(el, { rpc, esc, toast, errBox, state });
}
async function route() {
  if (!getSession()) return viewLogin();
  const tok = ++navToken; const h = location.hash.replace(/^#/, "") || "/";
  const [, p, arg] = h.split("?")[0].split("/");
  if (p === "file") return viewFile(tok);
  if (p === "requests" || p === "approvals") return viewSplit(tok, p, arg || null);
  if (p === "request" && arg) { location.replace(`#/requests/${arg}`); return; }
  if (p === "calendar") return viewCalendar(tok);
  if (p === "admin") return viewAdminPage(tok);
  if (p === "employees") return viewEmployeesPage(tok);
  if (p === "org") return viewOrgPage(tok);
  if (p === "schedules") return viewSchedulesPage(tok);
  return viewHome(tok);
}
document.addEventListener("click", async (ev) => { $toast.className = "";
  if (ev.target.closest("[data-act=signout]")) { await signOut(); state.me = null; state.isApprover = false; state.isAdmin = false; state.canPeople = false; state.empCompany = null; state.pending = 0; location.hash = "#/"; route(); }
});
window.addEventListener("hashchange", route);
async function bootSignedIn() {
  try { await loadMe(); } catch (e) {
    if (e.status === 401) { await signOut(); return viewLogin(); }
    $app.innerHTML = `<div class="auth"><div class="card"><h1>Can't open your account</h1>${errBox(e)}<button class="btn block" data-act="signout">Sign out</button></div></div>`; return; }
  await refreshBadge(); route();
}
async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (getSession()) await bootSignedIn(); else viewLogin();
  const tick = () => getSession() && state.me && refreshBadge();
  setInterval(tick, 60000); document.addEventListener("visibilitychange", () => !document.hidden && tick());
}
start();

// ---------- PDF form (FO-HRMD-14) ----------
async function downloadForm(r, apps, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Preparing PDF…";
  try {
    const safe = async (p) => { try { return await rest(p); } catch { return []; } };
    const [u, bal, sigs] = await Promise.all([
      safe(`users?id=eq.${encodeURIComponent(r.requester_id)}&select=full_name,roles(title),departments(name),companies(name,short_code)`),
      safe(`vw_leave_balances_live?user_id=eq.${encodeURIComponent(r.requester_id)}&year=eq.${YEAR}&select=leave_type_code,remaining`),
      safe(`iaf_signatures?leave_request_id=eq.${encodeURIComponent(r.id)}&select=purpose,created_at,user_id,signer:users!user_id(full_name)&order=created_at`) ]);
    const imgs = {};
    for (const uid of [...new Set(sigs.map((g) => g.user_id))]) {
      try { const row = (await safe(`iaf_signature_images?user_id=eq.${encodeURIComponent(uid)}&select=png_base64`))[0]; if (row) imgs[uid] = await pngToPdfImage(row.png_base64); } catch { /* the form is still produced without the drawn image */ }
    }
    const lastSig = (ps) => { const x = sigs.filter((g) => ps.includes(g.purpose)).slice(-1)[0]; return x ? { name: x.signer?.full_name || "", when: x.created_at, method: "biometric/PIN", img: imgs[x.user_id] || null } : null; };
    const emp = u[0] || {}, code = r.leave_types?.code;
    const left = (c) => { const b = bal.find((x) => x.leave_type_code === c); return b ? num(b.remaining) : null; };
    const final = apps.filter((a) => a.action === "APPROVED" || a.action === "REJECTED").slice(-1)[0];
    const first = apps.find((a) => a.action === "APPROVED" || a.action === "REJECTED");
    const decision = r.status === "APPROVED" || r.status === "FILED" ? "APPROVED" : r.status === "REJECTED" ? "REJECTED" : null;
    const pdf = buildAtrfPdf({
      companyName: emp.companies?.name || "", companyCode: emp.companies?.short_code || "", controlNo: "QC26-001", ref: "LV-" + String(r.id).slice(0, 8).toUpperCase(),
      name: emp.full_name || r.requester?.full_name || "", dateFiled: r.created_at, designation: emp.roles?.title || "", department: emp.departments?.name || "",
      types: { vl: code === "VL", sl: code === "SL", unpaid: !!r.is_unpaid_loa_conversion },
      purpose: r.reason || "", from: fmtDate(r.start_date), to: fmtDate(r.end_date), total: `${num(r.days_requested)} day(s)`,
      decision, rejectReason: decision === "REJECTED" ? (final?.notes || "") : "", dateActioned: decision ? (final?.created_at || null) : null,
      approverSig: lastSig(["APPROVE", "REJECT"]), employeeSig: lastSig(["ACCEPT", "SUBMIT"]), hrSig: null, balVL: left("VL"), balSL: left("SL") });
    void first;
    const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
    const link = document.createElement("a"); link.href = url; link.download = `FO-HRMD-14_${(emp.full_name || "leave").replace(/\s+/g, "_")}_${r.start_date}.pdf`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast(e.message || "Could not make the PDF", true); }
  finally { btn.disabled = false; btn.textContent = label; }
}
