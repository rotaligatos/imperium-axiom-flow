import { buildAtrfPdf, fmtDate } from "./atrf.js";
import { visibleGroups, renderRoles } from "./roles.js";
import { renderOb, renderObCheckins } from "./ob.js";
import { renderAdmin } from "./admin.js";
import { renderEmployees } from "./employees.js";
import { renderOrg } from "./org.js";
import { renderSchedules, dayLine } from "./schedules.js";
import { renderNotices, noticesHtml } from "./announcements.js";
import { renderShift } from "./shift.js";
import { renderTime } from "./timeadj.js";
import { renderHolidays } from "./holidays.js";
import { renderPolicies } from "./policies.js";
import { renderCredits } from "./credits.js";
import { renderCoc } from "./coc.js";
import { renderIr } from "./ir.js";
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
  state.canCoc = await rpc("iaf_coc_can_see").catch(() => false);   // Code of Conduct guide: supervisors and up, HR, admin
  state.irWaiting = await rpc("iaf_ir_waiting_count").catch(() => 0);
  state.late = await rpc("iaf_leave_late_summary").catch(() => ({ can_see: false }));
  state.irAny = true;                                   // everyone can file an incident report (General or IT form)
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
    if (!state.preview) document.querySelectorAll("[data-approver-nav]").forEach((el) => { el.hidden = !state.isApprover; });
  } catch { /* badge is best-effort */ }
}

// ---------- shell ----------
// The menu comes from js/roles.js (one definition, grouped). On a phone: Home, File leave, My requests, Approvals, More (all groups).
function navFlags() {
  if (state.preview) return state.preview.f;
  return { approver: state.isApprover, late: !!(state.late && state.late.can_see), coc: !!state.canCoc, people: state.canPeople, admin: state.isAdmin };
}
function shell(active, title, body, wide = false) {
  const f = navFlags();
  const link = ([h, t, ic, k], cls = "") => `<a href="${h}" class="${cls}${active === k ? " on" : ""}" ${k === "approvals" ? "data-approver-nav " + (f.approver ? "" : "hidden") : ""}>
      <span class="ic" aria-hidden="true">${ic}</span><span>${t}</span>${k === "approvals" ? `<b class="badge" data-badge ${state.pending ? "" : "hidden"}>${state.pending}</b>` : ""}</a>`;
  const home = ["#/", "Home", "🏠", "home"], acct = ["#/account", "Account", "👤", "account"];
  const groups = visibleGroups(f).map((g) => {
    const on = g.items.some((it) => it[3] === active);
    return `<div class="ngroup${on ? " on" : ""}"><div class="nh">${esc(g.title)}</div>${g.items.map((it) => link(it)).join("")}</div>`;
  }).join("");
  const tabs = [home, ["#/file", "File", "➕", "file"], ["#/requests", "Requests", "📄", "requests"], ["#/approvals", "Approvals", "✅", "approvals"]].map((it) => link(it)).join("")
    + `<a href="javascript:void 0" data-more class="${["home", "file", "requests", "approvals"].includes(active) ? "" : "on"}"><span class="ic" aria-hidden="true">☰</span><span>More</span></a>`;
  const pv = state.preview ? `<div class="alert warn previewbar">Previewing the menu as <b>${esc(state.preview.name)}</b>. Pages still open with your own access. <button class="btn" data-act="endpreview">Exit preview</button></div>` : "";
  $app.innerHTML = `<div class="layout">
    <aside class="side"><div class="brand"><img class="logo" src="icons/icon-192.png" alt="IAF"><div><strong>Imperium Axiom Flow</strong><small>HR</small></div></div>
      <nav>${link(home)}${groups}${link(acct)}</nav>
      <div class="me"><div class="av">${esc(initials(state.me?.full_name))}</div><div class="who">${esc(state.me?.full_name)}</div>
        <button class="link" data-act="signout">Sign out</button></div></aside>
    <main><header class="top"><h1>${esc(title)}</h1><button class="link only-mobile" data-act="signout">Sign out</button></header>
      ${pv}<div class="content${wide ? " wide" : ""}">${body}</div></main>
    <nav class="tabs">${tabs}</nav>
    <div class="sheet" id="moresheet" hidden><div class="sheetin"><div class="between"><b>Menu</b><button class="link" data-more>Close</button></div>
      <nav class="sheetnav">${link(home)}${groups}${link(acct)}</nav></div></div></div>`;
}
const loading = (t = "Loading…") => `<div class="empty loading">${esc(t)}</div>`;
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
    const [bal, reqs] = await Promise.all([
      rest(`vw_leave_balances_live?user_id=eq.${userId()}&year=eq.${YEAR}&select=leave_type_code,total_allotment,used,remaining`),
      rest(`leave_requests?requester_id=eq.${userId()}&select=id,start_date,end_date,days_requested,status,leave_types(code,display_name)&order=created_at.desc&limit=5`) ]);
    if (tok !== navToken) return;
    const cards = ["VL", "SL"].map((c) => {
      const b = bal.find((x) => x.leave_type_code === c);
      const name = c === "VL" ? "Vacation Leave" : "Sick Leave";
      if (!b) return `<div class="bal"><div class="bn">${name}</div><div class="bv">—</div><div class="bs">No ${YEAR} balance set up yet</div></div>`;
      const pct = Number(b.total_allotment) ? Math.max(0, Math.min(100, (Number(b.remaining) / Number(b.total_allotment)) * 100)) : 0;
      return `<div class="bal"><div class="bn">${name}</div><div class="bv">${num(b.remaining)}<small> days left</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div><div class="bs">${num(b.used)} used of ${num(b.total_allotment)} in ${YEAR}</div>${c === "VL" ? `<div class="bs h1" id="vlh1"></div>` : ""}</div>`; }).join("");
    const recent = reqs.length ? reqs.map((r) => reqRow(r)).join("") : `<div class="empty">No requests yet.</div>`;
    el.innerHTML = `<div id="homeextra"></div><div class="bals">${cards}</div>
      <a class="btn primary block" href="#/file">➕ File a leave</a>
      ${state.pending ? `<a class="notice" href="#/approvals"><b>${state.pending}</b> request${state.pending > 1 ? "s" : ""} waiting for your decision →</a>` : ""}
      <h2>Recent requests</h2><div class="list">${recent}</div>
      ${reqs.length ? `<a class="link" href="#/requests">See all →</a>` : ""}`;
    // Extras never block the Home screen: a slow or failing call just leaves that card out.
    const soft = (pr, ms = 8000) => Promise.race([pr, new Promise((r) => setTimeout(() => r(null), ms))]).catch(() => null);
    soft(rpc("iaf_my_leave_summary", { p_year: YEAR })).then((sm) => { const h = sm?.vl_first_half, box = document.getElementById("vlh1");
      if (!h || !box || tok !== navToken || new Date().getMonth() > 5) return;
      box.textContent = `Until June 30: ${num(h.left)} of ${num(h.cap)} days left to use (half of your VL). More needs approval.`; });
    Promise.all([soft(rpc("iaf_my_schedule", { p_days: 7 })), soft(rpc("iaf_my_announcements")), soft(rpc("iaf_shift_change_inbox")), soft(rpc("iaf_time_adj_inbox")), soft(rpc("iaf_shift_change_news")), soft(rpc("iaf_shift_change_mine")), soft(rpc("iaf_holidays", { p_from: todayStr(), p_to: ymd(new Date(Date.now() + 30 * 86400000)) })), soft(rpc("iaf_holiday_alerts")), soft(rpc("iaf_ob_today"))]).then(([mySch, myNotices, shiftIn, timeIn, shiftNews, shiftMine, hols, halert, obToday]) => {
      const box = document.getElementById("homeextra"); if (!box || tok !== navToken) return;
      const schedCard = mySch && mySch.linked && mySch.days.length ? `<div class="card mysched"><h3>My schedule</h3>${mySch.days.map((d, i) => `<div class="row${i === 0 ? " today" : ""}${d.rest ? " rest" : ""}"><span>${i === 0 ? "Today" : new Date(d.date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</span><span>${esc(dayLine(d))}</span></div>`).join("")}${mySch.days[0].schedule ? `<p class="s">${esc(mySch.days[0].schedule)}</p>` : ""}</div>` : "";
      const shiftCard = Array.isArray(shiftIn) && shiftIn.length ? `<a class="notice" href="#/shift"><b>${shiftIn.length}</b> shift change request${shiftIn.length > 1 ? "s" : ""} waiting for your decision →</a>` : "";
      const timeCard = Array.isArray(timeIn) && timeIn.length ? `<a class="notice" href="#/time"><b>${timeIn.length}</b> half-day / undertime filing${timeIn.length > 1 ? "s" : ""} waiting for your decision →</a>` : "";
      const retCard = Array.isArray(shiftMine) && shiftMine.some((r) => r.mine && r.status === "returned") ? `<a class="notice" href="#/shift">A shift change you filed was returned to you for changes →</a>` : "";
      const newsCard = (Array.isArray(shiftNews) ? shiftNews : []).map((r) => `<div class="notice"><b>Shift change approved:</b> ${esc(r.schedule)} for ${esc(r.dept ? "department " + r.dept : (r.people || []).slice(0, 3).join(", ") + ((r.people || []).length > 3 ? " +" + (r.people.length - 3) : ""))}, from ${esc(r.start_date)}${r.end_date ? " to " + esc(r.end_date) : ""} <button class="link" data-newsseen="${esc(r.id)}">Got it</button></div>`).join("");
      const holAlert = halert && halert.proposed > 0 && state.canPeople ? `<a class="notice" href="#/holidays"><b>${halert.proposed}</b> holiday${halert.proposed > 1 ? "s" : ""} waiting for your confirmation →</a>` : "";
      const holCard = Array.isArray(hols) && hols.length ? `<div class="card"><h3>Coming holidays</h3>${hols.slice(0, 4).map((h) => `<div class="row"><span>${esc(new Date(h.date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }))}</span><span>${esc(h.name)}${h.kind === "special_working" ? " (work day)" : ""}</span></div>`).join("")}</div>` : "";
      const irAlert = state.irWaiting > 0 ? `<a class="notice" href="#/ir"><b>${state.irWaiting}</b> incident report${state.irWaiting > 1 ? "s" : ""} waiting for you →</a>` : "";
      const lateAlert = state.late && state.late.can_see && state.late.recent > 0 ? `<a class="notice" href="#/late"><b>${state.late.recent}</b> late leave filing${state.late.recent > 1 ? "s" : ""} in the last 30 days →</a>` : "";
      const obAlert = (Array.isArray(obToday) ? obToday : []).map((o) => `<a class="notice" href="#/ob">📍 <b>Official business today</b>: ${esc(o.destination || "")} — ${o.arrived_at ? "checked in ✔" : "check in when you arrive →"}</a>`).join("");
      box.innerHTML = obAlert + irAlert + lateAlert + holAlert + retCard + newsCard + shiftCard + timeCard + noticesHtml(Array.isArray(myNotices) ? myNotices : [], esc) + schedCard + holCard + `<a class="btn block" href="#/shift">🔄 Change shift</a><a class="btn block" href="#/time">⏱️ Half-day / Undertime</a>`;
    });
  } catch (e) { el.innerHTML = errBox(e); }
}

function reqRow(r, base = "#/requests/", activeId = null) {
  return `<a class="row${r.id === activeId ? " on" : ""}" href="${base}${esc(r.id)}"><div class="grow"><div class="t">${esc(r.leave_types?.display_name || "Leave")}${r.requester ? ` · ${esc(r.requester.full_name)}` : ""}</div>
    <div class="s">${esc(fmtRange(r.start_date, r.end_date))} · ${num(r.days_requested)} day${Number(r.days_requested) === 1 ? "" : "s"}${r.vl_h1_over ? ` · <span class="warnt">past Jan–Jun half</span>` : ""}${r.is_late ? ` · <span class="warnt">late filing</span>` : ""}</div></div>${chip(r.status)}</a>`;
}

// (viewRequests / viewApprovals are now viewSplit, below)

const REL = { parent: "Parent", sibling: "Brother / sister", spouse: "Husband / wife", child: "Child" };
async function viewFile(tok) {
  shell("file", "File a leave", loading());
  const el = document.querySelector(".content");
  try {
    let types; try { types = await rpc("iaf_leave_types_for_me"); } catch { types = (await loadTypes()).map((x) => ({ ...x, available: true, docs: [], day_basis: "working" })); }
    if (tok !== navToken) return;
    const avail = types.filter((x) => x.available), off = types.filter((x) => !x.available);
    const t = todayStr();
    el.innerHTML = `<form id="ff" class="form">
      <label>Type<select name="type" required>${avail.map((x) => `<option value="${esc(x.code)}">${esc(x.display_name)}</option>`).join("")}</select>
        ${off.length ? `<small>Not available to you: ${off.map((x) => `${esc(x.display_name)} (${esc(x.why)})`).join(", ")}</small>` : ""}</label>
      <div id="tnote"></div>
      <div id="tdetail"></div>
      <div class="two"><label>From<input type="date" name="start" value="${t}" required></label><label>To<input type="date" name="end" value="${t}" required></label></div>
      <label>Number of days<input type="number" name="days" min="0.5" step="0.5" inputmode="decimal" value="1" required>
        <small id="dayhint"></small></label>
      <label><span id="rlabel">Reason</span><textarea name="reason" rows="3" maxlength="500" minlength="3" required placeholder="Tell your approver why you are filing this leave"></textarea></label>
      <label class="check" id="covrow" hidden><input type="checkbox" name="cov"><span>Use my Vacation Leave to cover an exhausted Sick Leave<small>This needs extra approval from the HR Manager.</small></span></label>
      <div id="chk"></div><div id="h1warn"></div><div id="ferr"></div><button class="btn primary block" type="submit">Sign &amp; submit</button><p class="s" style="text-align:center">Your fingerprint, face or device PIN is your signature on the form.</p>
      <p class="fine" id="routefine">Your request goes to your approver automatically. You'll see its progress under “My requests”. <a href="#/policies">Leave rules &amp; memos →</a></p></form>`;
    const f = document.getElementById("ff");
    const pre = new URLSearchParams(location.hash.split("?")[1] || "").get("type"); if (pre && avail.some((x) => x.code === pre)) f.type.value = pre;
    const typeOf = () => types.find((x) => x.code === f.type.value) || {};
    let touchedDays = false;
    // per-type extra questions (kept in the form while switching types)
    const renderType = () => {
      const ty = typeOf(), c = ty.code;
      document.getElementById("tnote").innerHTML = ty.note || (ty.docs || []).length
        ? `<div class="alert ${ty.confidential ? "warn" : ""}">${ty.confidential ? "<b>🔒 Confidential.</b> " : ""}${esc(ty.note || "")}${(ty.docs || []).length ? `<br><small>Documents: ${ty.docs.map(esc).join(" · ")}</small>` : ""}</div>` : "";
      const d = document.getElementById("tdetail");
      d.innerHTML = c === "BEREAVEMENT" ? `<div class="two"><label>Who passed away?<select name="rel"><option value="">— choose —</option>${Object.entries(REL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
            <label>Name of the deceased<input name="deceased" maxlength="120"></label></div>`
        : c === "MATERNITY" ? `<fieldset class="fs"><legend>Maternity</legend><label class="check"><input type="radio" name="mkind" value="birth" checked><span>Childbirth (normal or caesarean)</span></label>
            <label class="check"><input type="radio" name="mkind" value="miscarriage"><span>Miscarriage / pregnancy loss</span></label>
            <label id="trrow">Days given to the child's father (0–7)<input type="number" name="transfer" min="0" max="7" step="1" value="0"></label></fieldset>`
        : c === "PATERNITY" ? `<label>Date of the delivery or miscarriage<input type="date" name="delivery"></label>`
        : c === "OB" ? `<fieldset class="fs"><legend>Official business</legend><label>Where are you going? (company / site / address)<input name="obdest" maxlength="300" placeholder="e.g. J Tower, Ortigas — client site measurement"></label>
            <div class="two"><label>Time out <span class="opt">(expected)</span><input type="time" name="obout"></label><label>Time back <span class="opt">(expected)</span><input type="time" name="obin"></label></div>
            <p class="s">On the day, open the app at the place and check in with a photo. Choose how your location is shown:</p>
            <label class="check"><input type="radio" name="obmode" value="geotag" checked><span><b>Geo-tag</b> — one photo with the location when you arrive</span></label>
            <label class="check"><input type="radio" name="obmode" value="tracking"><span><b>Tracking</b> — arrival photo, then your location is recorded while the app is open</span></label></fieldset>`
        : c === "VL" ? `<label class="check"><input type="checkbox" name="emerg"><span>Emergency leave — I told my supervisor and HR within the first hour of the working day (medical or family reason)</span></label>` : "";
      const cal = ty.day_basis === "calendar";
      f.days.readOnly = cal; f.days.step = cal ? "1" : "0.5";
      document.getElementById("rlabel").textContent = ty.confidential ? "Reason (only HR will see this)" : "Reason";
      document.getElementById("routefine").innerHTML = ty.confidential
        ? "This goes straight to HR. Your supervisor and manager only see “Leave (confidential)” and the dates."
        : `Your request goes to your approver automatically. You'll see its progress under “My requests”. <a href="#/policies">Leave rules &amp; memos →</a>`;
      d.querySelectorAll("input,select").forEach((x) => x.addEventListener("change", () => { if (x.name === "mkind") document.getElementById("trrow").hidden = x.value !== "birth"; check(); }));
      d.querySelectorAll("input[name=deceased],input[name=obdest]").forEach((x) => x.addEventListener("input", check));
    };
    const detail = () => {
      const c = f.type.value;
      if (c === "BEREAVEMENT") return { relationship: f.rel.value, deceased_name: f.deceased.value.trim() };
      if (c === "MATERNITY") { const k = (f.querySelector("input[name=mkind]:checked") || {}).value || "birth"; return { kind: k, transfer_days: k === "birth" ? Number(f.transfer.value || 0) : 0 }; }
      if (c === "PATERNITY") return { delivery_date: f.delivery.value || null };
      if (c === "VL") return f.emerg && f.emerg.checked ? { emergency: true } : null;
      if (c === "OB") return { destination: f.obdest.value.trim(), time_out: f.obout.value || null, time_in: f.obin.value || null, mode: (f.querySelector("input[name=obmode]:checked") || {}).value || "geotag" };
      return null;
    };
    const sync = () => {
      const s = f.start.value, e = f.end.value; const hint = document.getElementById("dayhint");
      if (s && e && e >= s) { const span = spanDays(s, e); f.days.max = span; if (!touchedDays || typeOf().day_basis === "calendar") f.days.value = span;
        hint.textContent = typeOf().day_basis === "calendar" ? `${span} calendar day${span > 1 ? "s" : ""} (this leave counts every day, including weekends).`
          : `${span} calendar day${span > 1 ? "s" : ""} selected — lower this to skip weekends/rest days, or use 0.5 for a half day.`; }
      else hint.textContent = "“To” must be on or after “From”.";
      document.getElementById("covrow").hidden = f.type.value !== "VL";
      if (f.type.value !== "VL") f.cov.checked = false;
    };
    f.days.addEventListener("input", () => (touchedDays = true));
    // working days = the person's schedule minus rest days and holidays (the server counts the same way and refuses more)
    let cseq = 0;
    const count = async () => {
      const s = f.start.value, e = f.end.value, my = ++cseq; if (!s || !e || e < s || typeOf().day_basis === "calendar") return;
      try { const c = await rpc("iaf_leave_count", { p_start: s, p_end: e }); if (my !== cseq) return;
        if (!c.assumed) { f.days.max = Math.max(c.days, 0.5); if (!touchedDays) f.days.value = c.days || 0; }
        const sk = (c.skipped || []).map((x) => `${new Date(x.date + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" })} (${x.why})`);
        document.getElementById("dayhint").textContent = `${c.days} working day${c.days === 1 ? "" : "s"}${c.assumed ? " (no schedule set yet — counted Mon–Fri)" : ""}${sk.length ? " · not counted: " + sk.join(", ") : ""}. Use 0.5 for a half day.`;
      } catch {}
    };
    // eligibility + limits for the chosen type (the server runs the same check when you submit)
    let kseq = 0, blocked = false;
    const check = async () => { const box = document.getElementById("chk"), my = ++kseq;
      if (!f.start.value || !f.end.value) return;
      try { const k = await rpc("iaf_leave_check", { p_code: f.type.value, p_start: f.start.value, p_end: f.end.value, p_days: Number(f.days.value) || null, p_detail: detail() }); if (my !== kseq || !k) return;
        const needsDetail = (k.errors || []).every((x) => /^(Choose who passed|Enter the name|Enter the date)/.test(x));
        blocked = !k.ok;
        box.innerHTML = (k.errors || []).length ? `<div class="alert ${needsDetail ? "warn" : "bad"}">${k.errors.map(esc).join("<br>")}</div>` : "";
        if ((k.warnings || []).length) box.innerHTML += `<div class="alert warn">${k.warnings.map(esc).join("<br>")}</div>`;
        if (k.ok && k.max_days != null && typeOf().code !== "VL" && typeOf().code !== "SL") box.innerHTML += `<p class="s">You can file up to <b>${num(k.max_days)}</b> day(s) of ${esc(typeOf().display_name)} here.${k.note && k.note !== typeOf().note ? " " + esc(k.note) : ""}</p>`;
      } catch { blocked = false; box.innerHTML = ""; } };
    // January–June: only half of the year's VL; more is allowed but needs the approver's approval
    let hseq = 0;
    const half = async () => { const box = document.getElementById("h1warn"), my = ++hseq; box.innerHTML = "";
      if (f.type.value !== "VL" || !f.start.value || !f.end.value || f.end.value < f.start.value || !Number(f.days.value)) return;
      try { const h = await rpc("iaf_leave_vl_h1_preview", { p_start: f.start.value, p_end: f.end.value, p_days: Number(f.days.value) }); if (my !== hseq) return;
        if (h && h.applies && Number(h.over) > 0) box.innerHTML = `<div class="alert warn">From January to June only half of your Vacation Leave can be used (${num(h.cap)} of ${num(h.total)} days; ${num(h.left)} left). ${num(h.over)} day${Number(h.over) === 1 ? "" : "s"} of this request go${Number(h.over) === 1 ? "es" : ""} past that, so your approver will see it marked as needing approval.</div>`;
      } catch {} };
    ["start", "end", "type"].forEach((n) => f[n].addEventListener("change", () => {
      if (n === "type") { touchedDays = false; renderType(); }
      else touchedDays = false;
      if (n === "start" && f.end.value < f.start.value) f.end.value = f.start.value;
      sync(); count().then(() => { half(); check(); }); }));
    f.days.addEventListener("change", () => { half(); check(); });
    renderType(); sync(); count().then(() => { half(); check(); });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const btn = f.querySelector("button[type=submit]");
      document.getElementById("ferr").innerHTML = "";
      if (blocked) { document.getElementById("ferr").innerHTML = errBox(new Error("Please fix the points above first.")); return; }
      btn.disabled = true; btn.textContent = "Submitting…";
      try {
        if (f.reason.value.trim().length < 3) throw new Error("Please enter a reason for your leave.");
        btn.textContent = "Waiting for your fingerprint / face / PIN…";
        const sig = await sign("SUBMIT", state.me?.full_name);
        btn.textContent = "Submitting…";
        const id = await rpc("iaf_leave_submit2", { p_leave_type_code: f.type.value, p_start_date: f.start.value, p_end_date: f.end.value,
          p_days: Number(f.days.value), p_reason: f.reason.value.trim(), p_detail: detail(), p_is_wfh: f.type.value === "WFH", p_is_vl_covering_sl: !!f.cov.checked, p_signature_id: sig });
        toast(typeOf().confidential ? "Sent to HR ✔" : "Leave submitted ✔"); location.hash = `#/requests/${id}`;
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
    ? `leave_requests?current_approver_id=eq.${userId()}&status=in.(${PENDING_FOR_APPROVER.join(",")})&select=id,start_date,end_date,days_requested,status,vl_h1_over,is_late,leave_types(code,display_name),requester:users!requester_id(full_name)&order=created_at`
    : `leave_requests?requester_id=eq.${userId()}&select=id,start_date,end_date,days_requested,status,vl_h1_over,is_late,leave_types(code,display_name)&order=created_at.desc&limit=100`;
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
    let priv = null; if (r.leave_types?.code === "CONFIDENTIAL") { try { priv = await rpc("iaf_leave_private_get", { p_request: r.id }); } catch {} }
    const dt = priv?.detail || r.detail || {};
    const detailRows = [
      dt.relationship ? `<dt>Deceased</dt><dd>${esc(dt.deceased_name || "")} (${esc(REL[dt.relationship] || dt.relationship)})</dd>` : "",
      dt.kind ? `<dt>Maternity</dt><dd>${dt.kind === "miscarriage" ? "Miscarriage" : "Childbirth"}${Number(dt.transfer_days) ? ` · ${num(dt.transfer_days)} day(s) given to the father` : ""}</dd>` : "",
      dt.delivery_date ? `<dt>Delivery date</dt><dd>${esc(fmtDate(dt.delivery_date))}</dd>` : "",
      dt.destination ? `<dt>Going to</dt><dd>${esc(dt.destination)}${dt.time_out || dt.time_in ? `<br><small>Out ${esc(dt.time_out || "–")} · back ${esc(dt.time_in || "–")}</small>` : ""}<br><small>Location: ${dt.mode === "tracking" ? "tracking" : "geo-tag"}</small></dd>` : "" ].join("");
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
    if (priv && priv.is_hr && r.status === "PENDING_HR_MANAGER") {
      actions += `<div class="card" id="handover"><h3>Who handles this case?</h3>
        <p class="s">Only HR sees the details. If a supervisor or manager needs to decide, hand the case to them: they will see the type and the reason. You can take it back while it is waiting.</p>
        <form class="form" id="hform"><label>Hand to<select name="u"><option value="">Loading…</option></select></label>
        <label><span>Why <span class="opt">(required when handing to a non-HR person)</span></span><input name="note" maxlength="300"></label>
        <div class="eerr"></div><button class="btn" type="submit">Hand over</button></form></div>`;
    }
    if (priv && priv.delegate && !mine) actions = `<div class="alert">HR handed this case to <b>${esc(priv.delegate)}</b>${priv.delegate_note ? `: “${esc(priv.delegate_note)}”` : ""}</div>` + actions;
    if (mine && CANCELLABLE.includes(r.status) && r.status !== "COUNTERED") actions += `<button class="btn danger block" data-act="cancel">Cancel this request</button>`;
    const tl = apps.map((a) => `<li><b>${esc(a.approver?.full_name || "Approver")}</b> ${a.action === "APPROVED" ? "approved" : a.action === "REJECTED" ? "rejected" : "proposed other dates"}
      <small>${esc(a.tier.replace("_", " ").toLowerCase())} · ${esc(new Date(a.created_at).toLocaleString())}</small>${a.notes ? `<em>“${esc(a.notes)}”</em>` : ""}</li>`).join("");
    el.innerHTML = back + `<div class="card"><div class="between"><h2 class="nm">${esc(r.leave_types?.display_name)}</h2>${chip(r.status)}</div>
      ${!mine ? `<p class="s">Requested by <b>${esc(r.requester?.full_name)}</b></p>` : ""}
      <dl><dt>Dates</dt><dd>${esc(fmtRange(r.start_date, r.end_date))}</dd><dt>Days</dt><dd>${num(r.days_requested)}</dd>
      ${priv ? `<dt>Type</dt><dd>🔒 ${esc(priv.type_name || priv.type_code)} <small>(only you and HR see this)</small></dd>` : ""}
      ${(priv?.reason || r.reason) ? `<dt>Reason</dt><dd>${esc(priv?.reason || r.reason)}</dd>` : ""}${detailRows}
      ${r.is_vl_covering_sl ? `<dt>Note</dt><dd>VL covering exhausted SL (HR Manager approval required)</dd>` : ""}
      ${r.is_unpaid_loa_conversion ? `<dt>Note</dt><dd>Balance ran out — converted to unpaid leave</dd>` : ""}
      ${r.is_late ? `<dt>Late filing</dt><dd class="warnt">${esc(r.late_note || "Filed later than the notice the policy asks for")}. Your manager and HR see it on the late filing list.</dd>` : ""}
      ${r.detail && r.detail.emergency ? `<dt>Emergency</dt><dd>Emergency leave (told supervisor and HR within the first hour)</dd>` : ""}
      ${r.vl_h1_over ? `<dt>Note</dt><dd class="warnt">Uses more than half of the year's Vacation Leave before July 1 — this needs ${mine ? "your approver's" : "your"} approval (company policy: only half can be used January–June).</dd>` : ""}
      ${r.approver && PENDING_FOR_APPROVER.includes(r.status) ? `<dt>Waiting on</dt><dd>${esc(r.approver.full_name)}</dd>` : ""}</dl></div>
      <button class="btn block" data-act="pdf">Download form (PDF)</button>
      ${r.leave_types?.code === "OB" ? '<div id="obck"></div>' : ""}
      ${actions}<h3>History</h3>${tl ? `<ol class="tl">${tl}</ol>` : `<div class="empty small">No decisions yet.</div>`}`;
    const hf = el.querySelector("#hform");
    if (hf) {
      rpc("iaf_leave_conf_people", { p_request: r.id }).then((ppl) => {
        hf.u.innerHTML = ppl.map((x) => `<option value="${esc(x.id)}" ${x.id === r.current_approver_id ? "selected" : ""}>${esc(x.full_name)}${x.hr ? " (HR)" : x.title ? " — " + esc(x.title) : ""}</option>`).join("");
      }).catch((e) => { hf.querySelector(".eerr").innerHTML = errBox(e); });
      hf.onsubmit = async (ev) => { ev.preventDefault(); hf.querySelector(".eerr").innerHTML = "";
        try { await rpc("iaf_leave_conf_assign", { p_request: r.id, p_user: hf.u.value, p_note: hf.note.value || null }); toast("Handed over ✔"); route(); }
        catch (e) { hf.querySelector(".eerr").innerHTML = errBox(e); } };
    }
    el.__apps = apps; wireDetail(el, r);
    const obk = el.querySelector("#obck"); if (obk) renderObCheckins(obk, r.id, { rpc, esc, toast, errBox });
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
    const [rows, hols0] = await Promise.all([rest(`vw_leave_calendar?start_date=lte.${ymd(last)}&end_date=gte.${ymd(first)}&select=full_name,leave_type_code,start_date,end_date,is_wfh&order=start_date`),
      rpc("iaf_holidays", { p_from: ymd(first), p_to: ymd(last) }).catch(() => [])]);
    if (tok !== navToken) return;
    const holBy = {}; (Array.isArray(hols0) ? hols0 : []).forEach((h) => (holBy[h.date] ||= []).push(h));
    const byDay = {};
    rows.forEach((r) => { for (let d = new Date(Math.max(pd(r.start_date), first)); d <= Math.min(pd(r.end_date), last); d.setDate(d.getDate() + 1)) (byDay[ymd(d)] ||= []).push(r); });
    const lead = first.getDay(); let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="dow">${d}</div>`).join("") + '<div></div>'.repeat(lead);
    for (let i = 1; i <= last.getDate(); i++) { const k = ymd(new Date(first.getFullYear(), first.getMonth(), i)); const n = byDay[k]?.length || 0;
      cells += `<button class="day ${n ? "has" : ""} ${holBy[k] ? "hol" : ""} ${k === todayStr() ? "today" : ""}" data-day="${k}"${holBy[k] ? ` title="${esc(holBy[k].map((h) => h.name).join(", "))}"` : ""}>${i}${n ? `<i>${n}</i>` : ""}</button>`; }
    el.innerHTML = `<div class="between mhead"><button class="btn sm" data-m="-1" aria-label="Previous month">‹</button><h2>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><button class="btn sm" data-m="1" aria-label="Next month">›</button></div>
      <div class="calwrap"><div class="calmain"><div class="grid">${cells}</div></div><aside id="dayinfo" class="list calside"></aside></div>`;
    const holLine = (k) => (holBy[k] || []).map((h) => `<div class="alert warn">🎌 ${esc(h.name)}${h.kind === "special_working" ? " (work day)" : " — holiday"}</div>`).join("");
    const show = (k) => { document.getElementById("dayinfo").innerHTML = (byDay[k] || []).length
      ? `<h3>${esc(fmtD(k))}</h3>` + holLine(k) + byDay[k].map((r) => `<div class="row"><div class="av sm">${esc(initials(r.full_name))}</div><div class="grow"><div class="t">${esc(r.full_name)}</div><div class="s">${esc(r.leave_type_code)}${r.is_wfh ? " · WFH" : ""} · ${esc(fmtRange(r.start_date, r.end_date))}</div></div></div>`).join("")
      : `<h3>${esc(fmtD(k))}</h3>` + holLine(k) + `<div class="empty small">Nobody is out.</div>`; };
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
async function viewNoticesPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("notices", "Announcements", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderNotices(el, { rpc, esc, toast, errBox, state });
}
async function viewShiftPage(tok) {
  shell("shift", "Change shift", loading());
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderShift(el, { rpc, esc, toast, errBox });
}
async function viewTimePage(tok) {
  shell("time", "Half-day / Undertime", loading());
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderTime(el, { rpc, esc, toast, errBox });
}
async function viewAccount(tok) {
  shell("account", "Account", loading());
  const el = document.querySelector(".content");
  try {
    const [devs, myImg] = await Promise.all([myDevices().catch(() => []), rest(`iaf_signature_images?user_id=eq.${userId()}&select=png_base64`).catch(() => [])]);
    if (tok !== navToken) return;
    el.innerHTML = `<div class="card"><h3>${esc(state.me?.full_name || "")}</h3><p class="s">${esc(getSession()?.user?.email || "")}</p></div>
      <div class="card"><h3>My signature</h3>
        <p class="s">${devs.length ? `✔ Device set up (${esc(devs.map((d) => d.label || "Device").join(", "))}). You sign with your fingerprint, face or device PIN.`
          : "Step 1 — set up this device so your fingerprint, face or PIN can be your signature."}</p>
        ${devs.length ? `<button class="link" data-act="reg-device">Add another device</button>` : `<button class="btn block" data-act="reg-device">Set up this device</button>`}
        <p class="s" style="margin-top:14px">${myImg[0] ? "✔ Your drawn signature (shown on the printed form):" : "Step 2 — draw your signature. It appears on your leave forms once you file or approve."}</p>
        ${myImg[0] ? `<div class="sigprev"><img alt="Your signature" src="data:image/png;base64,${esc(myImg[0].png_base64)}"></div>` : ""}
        <div id="padhost"></div>
        <button class="btn block" data-act="draw-sig">${myImg[0] ? "Change signature" : "Draw my signature"}</button></div>`;
    el.querySelectorAll("[data-act=reg-device]").forEach((rb) => (rb.onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true;
      try { await registerDevice(state.me?.full_name); toast("This device is set up ✔"); route();
      } catch (e) { toast(e.message || "Could not set up this device", true); b.disabled = false; } }));
    el.querySelector("[data-act=draw-sig]").onclick = (ev) => { ev.currentTarget.hidden = true;
      mountPad(el.querySelector("#padhost"), { onCancel: () => route(), onSave: async (png) => { await rpc("iaf_signature_image_save", { p_png_base64: png }); toast("Signature saved ✔"); route(); } }); };
  } catch (e) { if (tok === navToken) el.innerHTML = errBox(e); }
}
async function viewPoliciesPage(tok) {
  shell("policies", "Policies & Memos", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderPolicies(el, { rpc, esc, toast, errBox, state });
}
async function viewIrPage(tok) {
  shell("ir", "Incident reports", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderIr(el, { rpc, esc, toast, errBox, state });
  state.irWaiting = await rpc("iaf_ir_waiting_count").catch(() => state.irWaiting);
}
async function viewObPage(tok) {
  shell("ob", "Official business", loading());
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  const body = document.createElement("div"); el.querySelector(".loading")?.remove(); el.appendChild(body);
  await renderOb(body, { rpc, esc, toast, errBox, state });
}
async function viewRolesPage(tok) {
  if (!state.isAdmin) { location.replace("#/"); return; }
  shell("roles", "View by role", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  const body = document.createElement("div"); el.querySelector(".loading")?.remove(); el.appendChild(body);
  renderRoles(body, { esc, state, onPreview: (r) => { state.preview = r; if (location.hash === "#/" || location.hash === "") route(); else location.hash = "#/"; } });
}
async function viewLatePage(tok) {
  if (!state.late || !state.late.can_see) { location.replace("#/"); return; }
  shell("late", "Late leave filings", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  const now = new Date(), ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  let companies = [];
  if (state.canPeople) companies = await rpc("iaf_my_companies").catch(() => []);
  const st = { co: state.lateCo || state.late.company_id, month: state.lateMonth || ym(now) };
  const load = async () => {
    const [y, m] = st.month.split("-").map(Number), from = `${st.month}-01`;
    const lastDay = `${st.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    el.innerHTML = `${companies.length > 1 ? `<div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === st.co ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>` : ""}
      <div class="card"><div class="between"><p class="s">Leave filed later than the notice in memo HRMD-26-29 (VL: 1 day = 2 working days ahead, 2–3 days = 1 week, more than 3 days = 2 weeks, 1 week or longer = 1 month · Maternity 1 month · Birthday, Solo Parent, Paternity, RA 9710, WFH, Unpaid before the first day). Emergency VL, Sick Leave and Bereavement are not counted.</p>
      <label>Month<input type="month" id="lmon" value="${esc(st.month)}"></label></div><div id="lrows">${loading()}</div></div>`;
    try {
      const r = await rpc("iaf_leave_late_list", { p_company: st.co, p_from: from, p_to: lastDay });
      const rows = r.rows || [];
      el.querySelector("#lrows").innerHTML = rows.length ? `<div class="tscroll"><table class="dtab"><tr><th>Filed</th><th>Employee</th><th>Department</th><th>Leave</th><th>Dates</th><th>Days</th><th>Rule missed</th><th>Status</th></tr>
        ${rows.map((x) => `<tr><td>${esc(new Date(x.filed).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td><td>${esc(x.name)}${x.approver && ["PENDING_SUPERVISOR", "PENDING_MANAGER", "PENDING_HR_MANAGER"].includes(x.status) ? `<br><small>waiting on ${esc(x.approver)}</small>` : ""}</td><td>${esc(x.dept || "—")}</td><td>${esc(x.type)}</td>
          <td>${esc(fmtRange(x.start_date, x.end_date))}</td><td>${num(x.days)}</td><td><small>${esc(x.rule || "")}</small></td><td>${chip(x.status)}</td></tr>`).join("")}</table></div>
        <p class="s">${rows.length} late filing${rows.length > 1 ? "s" : ""}${r.hr ? " in the company" : " by people under you"}.</p>` : `<div class="empty">No late filings in this month.</div>`;
    } catch (e) { el.querySelector("#lrows").innerHTML = errBox(e); }
  };
  el.onclick = (ev) => { const co = ev.target.closest("[data-co]"); if (co) { st.co = state.lateCo = co.dataset.co; load(); } };
  el.onchange = (ev) => { if (ev.target.id === "lmon" && ev.target.value) { st.month = state.lateMonth = ev.target.value; load(); } };
  await load();
}
async function viewCocPage(tok) {
  if (!state.canCoc) { location.replace("#/"); return; }
  shell("coc", "Code of Conduct", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderCoc(el, { rpc, esc, toast, errBox, state });
}
async function viewCreditsPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("credits", "Leave credits", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderCredits(el, { rpc, esc, toast, errBox, state });
}
async function viewHolidaysPage(tok) {
  if (!state.canPeople) { location.replace("#/"); return; }
  shell("holidays", "Holidays", loading(), true);
  const el = document.querySelector(".content"); if (tok !== navToken) return;
  await renderHolidays(el, { rpc, esc, toast, errBox, state });
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
  if (p === "notices") return viewNoticesPage(tok);
  if (p === "shift") return viewShiftPage(tok);
  if (p === "time") return viewTimePage(tok);
  if (p === "holidays") return viewHolidaysPage(tok);
  if (p === "account") return viewAccount(tok);
  if (p === "policies") return viewPoliciesPage(tok);
  if (p === "coc") return viewCocPage(tok);
  if (p === "ir") return viewIrPage(tok);
  if (p === "late") return viewLatePage(tok);
  if (p === "roles") return viewRolesPage(tok);
  if (p === "ob") return viewObPage(tok);
  if (p === "credits") return viewCreditsPage(tok);
  return viewHome(tok);
}
document.addEventListener("click", async (ev) => { $toast.className = "";
  const nseen = ev.target.closest("[data-newsseen]");
  if (nseen) { nseen.closest(".notice").remove(); try { await rpc("iaf_shift_change_news_seen", { p_id: nseen.dataset.newsseen }); } catch {} return; }
  const ack = ev.target.closest("[data-ack]");
  if (ack) { ack.disabled = true; try { await rpc("iaf_announcement_ack", { p_id: ack.dataset.ack }); toast("Thank you ✔"); route(); } catch (e) { toast(e.message, true); ack.disabled = false; } return; }
  if (ev.target.closest("[data-more]")) { const sh = document.getElementById("moresheet"); if (sh) sh.hidden = !sh.hidden; return; }
  if (ev.target.closest("#moresheet a[href]")) { const sh = document.getElementById("moresheet"); if (sh) sh.hidden = true; }
  if (ev.target.closest("[data-act=endpreview]")) { state.preview = null; route(); return; }
  if (ev.target.closest("[data-act=signout]")) { state.preview = null; await signOut(); state.me = null; state.isApprover = false; state.isAdmin = false; state.canPeople = false; state.empCompany = null; state.pending = 0; location.hash = "#/"; location.reload(); }
});
window.addEventListener("hashchange", route);
async function bootSignedIn() {
  try { await loadMe(); } catch (e) {
    if (e.status === 401) { await signOut(); return viewLogin(); }
    $app.innerHTML = `<div class="auth"><div class="card"><h1>Can't open your account</h1>${errBox(e)}<button class="btn block" data-act="signout">Sign out</button></div></div>`; return; }
  await refreshBadge(); route();
}
// If the screen is still "loading" after 15 seconds, offer a one-tap reset of this device's saved copy and sign-in.
function watchdog() {
  let since = 0;
  setInterval(() => {
    const stuck = document.querySelector("#login button[type=submit][disabled]") || (!document.querySelector("#login") && (document.querySelector(".content .loading") || !document.querySelector(".layout")));
    if (!stuck) { since = 0; document.getElementById("resetbar")?.remove(); return; }
    since ||= Date.now(); if (Date.now() - since < 15000 || document.getElementById("resetbar")) return;
    const bar = document.createElement("div"); bar.id = "resetbar";
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;background:#fff3cd;border-top:2px solid #e0a800;padding:12px 16px;z-index:99;font:14px system-ui";
    bar.innerHTML = 'Taking too long? <button id="resetbtn" style="margin-left:8px;padding:6px 12px">Reset this device and reload</button>';
    document.body.appendChild(bar);
    document.getElementById("resetbtn").onclick = async () => { try { localStorage.clear(); sessionStorage.clear(); (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister()); (await caches.keys()).forEach((k) => caches.delete(k)); } catch {} location.reload(); };
  }, 3000);
}
async function start() {
  watchdog();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
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
      types: { vl: code === "VL", sl: code === "SL", unpaid: !!r.is_unpaid_loa_conversion || code === "UNPAID_LOA", bday: code === "BIRTHDAY", solo: code === "SOLO_PARENT",
        bereave: code === "BEREAVEMENT", matpat: code === "MATERNITY" || code === "PATERNITY", wom: code === "RA9710", vawc: code === "RA9262", wfh: code === "WFH", ob: code === "OB" },
      destination: r.detail?.destination || "",
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
