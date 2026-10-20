// For HR review: items about an employee's record that only HR can decide (dates with no year, credits that differ
// from the leave table, names, resigned employees' credits, 201 to complete, missing medical certificates…).
// HR resolves or dismisses each one with a note of what was decided. Administrator and HR staff only.
export const TOPICS = { leave_days: "Leave days", leave_credits: "Leave credits", leave_dates: "Leave dates", medical_certificate: "Medical certificate",
  name: "Name", record: "201 record", loyalty: "Loyalty leave", separation: "Resigned / separated", other: "Other" };
const STAT = { open: ["Open", "warn"], resolved: ["Resolved", "ok"], dismissed: ["Dismissed", "mute"] };
const LCODE = { VL: "Vacation", SL: "Sick", LOYALTY: "Loyalty", PATERNITY: "Paternity", SOLO_PARENT: "Solo Parent", MATERNITY: "Maternity", BEREAVEMENT: "Bereavement", BIRTHDAY: "Birthday" };
let st = { co: null, status: "open", topic: "", q: "", year: new Date().getFullYear() };

export async function renderReview(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies, counts;
  try { [companies, counts] = await Promise.all([rpc("iaf_my_companies"), rpc("iaf_concern_counts").catch(() => [])]); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!companies.length) { el.innerHTML = `<div class="empty">No companies in your access.</div>`; return; }
  const cur = companies.find((c) => c.id === st.co) || companies.find((c) => c.id === state.empCompany) || companies[0];
  st.co = cur.id;
  const open = (id) => (counts.find((c) => c.company_id === id) || {}).open || 0;
  const reload = () => renderReview(el, ctx);
  let list, dir;
  try { [list, dir] = await Promise.all([rpc("iaf_concern_list", { p_company: cur.id, p_status: st.status }), rpc("iaf_employee_directory", { p_company: cur.id }).catch(() => [])]); }
  catch (e) { el.innerHTML = errBox(e); return; }
  const q = st.q.trim().toLowerCase();
  const rows = list.filter((x) => (!st.topic || x.topic === st.topic) && (!q || `${x.name || ""} ${x.hr_name || ""} ${x.detail}`.toLowerCase().includes(q)));
  const byTopic = {}; list.forEach((x) => (byTopic[x.topic] = (byTopic[x.topic] || 0) + 1));
  const when = (t) => (t ? new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");
  el.innerHTML = `<div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}${open(c.id) ? ` <small>(${open(c.id)})</small>` : ""}</button>`).join("")}</div>
    <div class="card"><p class="s">Things in an employee's record that HR has to decide — for example leave dates written without a year, credits different from the leave table, names spelled differently, or a resigned employee's credits. Write what was decided when you close an item; it is kept in the history.</p>
      <div class="rvbar"><label>Show<select id="rvs">${[["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["all", "All"]].map(([k, t]) => `<option value="${k}"${st.status === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Topic<select id="rvt"><option value="">All topics (${list.length})</option>${Object.entries(TOPICS).filter(([k]) => byTopic[k]).map(([k, t]) => `<option value="${k}"${st.topic === k ? " selected" : ""}>${t} (${byTopic[k]})</option>`).join("")}</select></label>
        <label>Search<input id="rvq" type="search" value="${esc(st.q)}" placeholder="Name or words"></label></div>
      <details class="rvadd"><summary>➕ Add an item for review</summary><form class="form" id="rvform">
        <label>Employee <span class="opt">(optional — leave empty for a company-wide item)</span><input name="emp" list="rvemps" autocomplete="off" placeholder="Type a name"><datalist id="rvemps">${(dir || []).map((e) => `<option value="${esc(e.full_name)}"></option>`).join("")}</datalist></label>
        <label>Topic<select name="t">${Object.entries(TOPICS).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
        <label>What needs review<textarea name="d" rows="3" maxlength="1000" required></textarea></label><div class="eerr"></div>
        <button class="btn primary" type="submit">Add</button></form></details></div>
    <p class="s">${rows.length} item${rows.length === 1 ? "" : "s"}${rows.length !== list.length ? ` of ${list.length}` : ""}.</p>
    <div class="rvlist">${rows.map((x) => `<div class="card rv" data-id="${esc(x.id)}">
      <div class="between"><div><b>${esc(x.name || "Whole company")}</b>${x.hr_name && x.name && x.hr_name.toLowerCase() !== x.name.toLowerCase() ? ` <small>· HR sheet: ${esc(x.hr_name)}</small>` : ""}
        <br><span class="chip tchip">${esc(TOPICS[x.topic] || x.topic)}</span> <small>${esc(x.source === "hr_monitoring" ? "from HR's leave monitoring" : "added by HR")} · ${esc(when(x.created_at))}</small></div>
        <span class="chip ${(STAT[x.status] || ["", "mute"])[1]}">${esc((STAT[x.status] || [x.status])[0])}</span></div>
      <p class="rvd">${esc(x.detail)}</p>
      ${x.status === "open" ? `<div class="rvact"><textarea rows="2" maxlength="1000" placeholder="What was decided (required to close)"></textarea>
          <div class="btns"><button class="btn primary sm" data-res="resolved">Resolved</button><button class="btn sm" data-res="dismissed">Dismiss</button>${x.employee_id ? `<button class="btn sm" data-hist="${esc(x.employee_id)}">Leave days</button>` : ""}</div></div>`
        : `<div class="alert ${x.status === "resolved" ? "ok" : ""}"><b>${esc((STAT[x.status] || [x.status])[0])}</b>${x.resolved_by ? ` by ${esc(x.resolved_by)}` : ""} ${esc(when(x.resolved_at))}${x.resolution ? `: ${esc(x.resolution)}` : ""}</div>
          <div class="btns"><button class="btn sm" data-res="open">Reopen</button>${x.employee_id ? `<button class="btn sm" data-hist="${esc(x.employee_id)}">Leave days</button>` : ""}</div>`}
      <div class="rvh" hidden></div></div>`).join("") || `<div class="empty">${st.status === "open" ? "Nothing waiting for review 🎉" : "No items."}</div>`}</div>`;

  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; st.topic = ""; reload(); }));
  el.querySelector("#rvs").onchange = (ev) => { st.status = ev.target.value; reload(); };
  el.querySelector("#rvt").onchange = (ev) => { st.topic = ev.target.value; reload(); };
  let qt; el.querySelector("#rvq").oninput = (ev) => { clearTimeout(qt); qt = setTimeout(() => { st.q = ev.target.value; reload(); }, 350); };
  const f = el.querySelector("#rvform");
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = "";
    const name = f.emp.value.trim(), e = name ? (dir || []).find((x) => x.full_name === name) : null;
    if (name && !e) { err.innerHTML = errBox(new Error("Choose the employee from the list, or leave it empty.")); return; }
    try { await rpc("iaf_concern_save", { p_company: cur.id, p_employee: e ? e.id : null, p_topic: f.t.value, p_detail: f.d.value }); toast("Added ✔"); st.status = "open"; reload(); }
    catch (x) { err.innerHTML = errBox(x); }
  };
  el.querySelectorAll(".rv").forEach((card) => {
    card.querySelectorAll("[data-res]").forEach((b) => (b.onclick = async () => {
      const note = card.querySelector("textarea")?.value.trim() || null;
      if (b.dataset.res !== "open" && !note) { toast("Write what was decided first.", true); card.querySelector("textarea")?.focus(); return; }
      b.disabled = true;
      try { await rpc("iaf_concern_resolve", { p_id: card.dataset.id, p_status: b.dataset.res, p_note: note }); toast(b.dataset.res === "open" ? "Reopened" : "Saved ✔"); reload(); }
      catch (x) { toast(x.message, true); b.disabled = false; }
    }));
    const hb = card.querySelector("[data-hist]");
    if (hb) hb.onclick = async () => {
      const box = card.querySelector(".rvh"); if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = `<div class="empty small">Loading…</div>`;
      try { const [a, b] = await Promise.all([st.year - 1, st.year].map((y) => rpc("iaf_leave_history", { p_employee: hb.dataset.hist, p_year: y })));
        box.innerHTML = historyHtml([...a, ...b], esc, `${st.year - 1}–${st.year}`); }
      catch (x) { box.innerHTML = errBox(x); }
    };
  });
}

// leave days HR recorded before the app, as a small table (also used on the Leave credits page)
export function historyHtml(days, esc, year) {
  if (!days || !days.length) return `<div class="empty small">No leave days recorded by HR for ${year}.</div>`;
  const tot = {}; days.forEach((d) => { const k = `${d.day.slice(0, 4)}|${d.code}`; tot[k] = (tot[k] || 0) + Number(d.days); });
  const fd = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `<p class="s"><b>Recorded by HR (leave monitoring) ${esc(String(year))}:</b> ${Object.entries(tot).map(([k, v]) => { const [y, c] = k.split("|"); return `${esc(LCODE[c] || c)}${String(year).includes("–") ? " " + y : ""}: ${v}`; }).join(" · ")}</p>
    <div class="tscroll"><table class="dtab"><tr><th>Date</th><th>Leave</th><th>Days</th><th>As written by HR</th></tr>
    ${days.map((d) => `<tr><td>${esc(fd(d.day))}</td><td>${esc(LCODE[d.code] || d.code)}</td><td>${Number(d.days) === 0.5 ? "½" : esc(String(Number(d.days)))}</td><td><small>${esc(d.as_written || d.note || "")}</small>${/year not written/.test(d.note || "") ? ' <span class="chip warn">year?</span>' : ""}</td></tr>`).join("")}</table></div>`;
}
