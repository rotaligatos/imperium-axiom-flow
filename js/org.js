// Org chart (administrator / HR staff): one department at a time, drag a person onto their manager.
// Drag works with mouse and touch (pointer events). Every box can also be edited without dragging (select a person → "Reports to").
const LEVELS = { 1: "Staff", 2: "Supervisor", 3: "Manager", 4: "Director / Head", 5: "Managing Director" };
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// Resize a picked image to a small square JPEG (data URL) so it stays tiny.
async function toSmallJpeg(file, side = 192) {
  const bmp = await createImageBitmap(file), s = Math.min(bmp.width, bmp.height), c = document.createElement("canvas"); c.width = c.height = side;
  c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side);
  for (const q of [0.82, 0.7, 0.55, 0.4]) { const u = c.toDataURL("image/jpeg", q); if (u.length < 90000) return u; }
  throw new Error("That picture is too detailed to shrink. Try a different one.");
}

let off = [];
export async function renderOrg(el, { rpc, esc, toast, errBox, state }) {
  off.forEach((f) => f()); off = [];
  const on = (t, fn) => { window.addEventListener(t, fn); off.push(() => window.removeEventListener(t, fn)); };
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies;
  try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  const cur = companies.find((c) => c.id === state.orgCompany) || companies.find((c) => c.id === state.empCompany) || companies[0]; state.orgCompany = cur.id;
  let dir, lk, photos;
  try { [dir, lk, photos] = await Promise.all([rpc("iaf_employee_directory", { p_company: cur.id }), rpc("iaf_org_lookups", { p_company: cur.id }), rpc("iaf_employee_photos", { p_company: cur.id })]); }
  catch (e) { el.innerHTML = errBox(e); return; }
  const photo = Object.fromEntries(photos.map((p) => [p.employee_id, p.data_url]));
  const active = dir.filter((p) => p.status === "active"), byId = Object.fromEntries(active.map((p) => [p.id, p]));
  const dept = state.orgDept && lk.departments.some((d) => d.id === state.orgDept) ? state.orgDept : "";
  const inView = (p) => !dept || p.dept_id === dept;
  const view = active.filter(inView), viewIds = new Set(view.map((p) => p.id));
  const kids = {}; view.forEach((p) => { if (p.reports_to_id && viewIds.has(p.reports_to_id)) (kids[p.reports_to_id] ||= []).push(p); });
  const byRank = (a, b) => b.role_level - a.role_level || a.full_name.localeCompare(b.full_name);
  const roots = view.filter((p) => !p.reports_to_id || !viewIds.has(p.reports_to_id)).sort(byRank);
  const descendants = (id, acc = new Set()) => { (kids[id] || []).forEach((k) => { acc.add(k.id); descendants(k.id, acc); }); return acc; };
  const sel = state.orgSel && byId[state.orgSel] ? byId[state.orgSel] : null;

  const avatar = (p) => (photo[p.id] ? `<img class="oav" src="${esc(photo[p.id])}" alt="">` : `<span class="oav ini">${esc(initials(p.full_name))}</span>`);
  const node = (p) => {
    const outside = p.reports_to_id && !viewIds.has(p.reports_to_id) && byId[p.reports_to_id];
    return `<div class="onode${sel && sel.id === p.id ? " sel" : ""}" data-id="${esc(p.id)}" data-drop>
      <span class="grab" title="Drag onto a manager">⠿</span>${avatar(p)}
      <div class="oi"><b>${esc(p.full_name)}</b><small>${esc(p.role_title || "No job title")}</small>${outside ? `<small class="up">↑ ${esc(byId[p.reports_to_id].full_name)}</small>` : ""}</div>
      ${p.has_login ? `<span class="dot" title="Has a login"></span>` : ""}</div>`;
  };
  const tree = (p) => `<li>${node(p)}${kids[p.id] ? `<ul>${kids[p.id].sort(byRank).map(tree).join("")}</ul>` : ""}</li>`;
  const optPeople = (excl, selId) => `<option value="">— top of the chart —</option>` + active.filter((p) => p.id !== excl).sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((p) => `<option value="${esc(p.id)}"${p.id === selId ? " selected" : ""}>${esc(p.full_name)} — ${esc(p.dept_name || "no dept")}</option>`).join("");

  el.innerHTML = `
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <div class="orgbar"><label>Department<select id="orgdept"><option value="">All departments</option>${lk.departments.map((d) => `<option value="${esc(d.id)}"${d.id === dept ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <small>${view.length} people${dept ? "" : " in the company"} · drag the ⠿ handle (or the whole box with a mouse) onto the person they report to · tap a box to edit</small></div>
    <div class="otop" data-drop data-top>⬆ Drop here to put someone at the top (no manager)</div>
    <div class="otree">${roots.length ? `<ul class="root">${roots.map(tree).join("")}</ul>` : `<div class="empty">Nobody in this department yet. Add or import people in the Employees tab.</div>`}</div>
    ${sel ? `<div class="card osel"><div class="between"><div class="orow">${avatar(sel)}<div><b>${esc(sel.full_name)}</b><br><small>${esc(sel.role_title || "No job title")}${sel.role_level ? ` · level ${sel.role_level} (${LEVELS[sel.role_level]})` : ""} · ${esc(sel.dept_name || "no department")}</small></div></div>
        <button class="link" data-close>Close</button></div>
      <label>Reports to<select id="osel-rep">${optPeople(sel.id, sel.reports_to_id)}</select></label>
      <div class="btns"><button class="btn" data-photo>${photo[sel.id] ? "Change photo" : "Add photo"}</button><input type="file" id="ofile" accept="image/*" hidden>
        ${photo[sel.id] ? "" : ""}</div>
      ${sel.has_login ? `<p class="s"><span class="chip ok">has login</span> Leave requests from this person go to the nearest person above them who also has a login.</p>`
        : state.isAdmin ? `<div id="olink"><p class="s">No login yet. To let this person file leave, create their login in Supabase (Authentication → Users → Add user), then link it here.</p><div class="empty small">Loading logins…</div></div>` : `<p class="s">No login yet. The administrator can link one.</p>`}
      <div id="oerr"></div></div>` : ""}`;

  const reload = () => renderOrg(el, { rpc, esc, toast, errBox, state });
  const setRep = async (id, mgr, msg = "Moved ✔") => { try { await rpc("iaf_org_set_reports_to", { p_employee_id: id, p_manager_id: mgr }); toast(msg); } catch (e) { toast(e.message, true); } await reload(); };

  // ---- selecting / buttons
  el.onclick = (ev) => {
    const co = ev.target.closest("[data-co]"); if (co) { state.orgCompany = co.dataset.co; state.orgDept = ""; state.orgSel = null; return reload(); }
    if (ev.target.closest("[data-close]")) { state.orgSel = null; return reload(); }
    if (ev.target.closest("[data-photo]")) return el.querySelector("#ofile").click();
    if (el._justDragged) return;
    const n = ev.target.closest(".onode"); if (n) { state.orgSel = n.dataset.id; reload().then(() => el.querySelector(".osel")?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }
  };
  el.onchange = (ev) => {
    if (ev.target.id === "orgdept") { state.orgDept = ev.target.value; state.orgSel = null; return reload(); }
    if (ev.target.id === "osel-rep") return setRep(sel.id, ev.target.value || null, "Saved ✔");
    if (ev.target.id === "ofile") { const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
      toSmallJpeg(f).then((u) => rpc("iaf_employee_photo_save", { p_employee_id: sel.id, p_data_url: u })).then(() => { toast("Photo saved ✔"); return reload(); }).catch((e) => toast(e.message, true)); }
  };

  // ---- login linking (administrator)
  if (sel && !sel.has_login && state.isAdmin) {
    rpc("iaf_link_candidates", { p_company: cur.id }).then((cands) => {
      const box = el.querySelector("#olink"); if (!box) return;
      const missing = !sel.role_id || !sel.dept_id;
      box.innerHTML = `<p class="s">No login yet. To let this person file leave, create their login in Supabase (Authentication → Users → Add user), then link it here.${missing ? ` <b>Set their department and job title first (Employees tab).</b>` : ""}</p>
        <form class="form" id="olinkf"><label>Login<select name="u" required><option value="">${cands.length ? "— choose —" : "— no unlinked logins —"}</option>
          ${cands.map((c) => `<option value="${esc(c.id)}">${c.kind === "login" ? "New login: " : "Existing user: "}${esc(c.label)}</option>`).join("")}</select></label>
          <div class="two"><label>VL days this year <span class="opt">(optional)</span><input name="vl" type="number" min="0" step="0.5"></label><label>SL days this year <span class="opt">(optional)</span><input name="sl" type="number" min="0" step="0.5"></label></div>
          <button class="btn primary" type="submit"${missing ? " disabled" : ""}>Give login access</button></form>`;
      box.querySelector("#olinkf").onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; f.querySelector("button").disabled = true;
        try { await rpc("iaf_employee_link_login", { p_employee_id: sel.id, p_user_id: f.u.value, p_vl_days: f.vl.value === "" ? null : Number(f.vl.value), p_sl_days: f.sl.value === "" ? null : Number(f.sl.value) });
          toast("Login linked ✔"); await reload(); } catch (e) { el.querySelector("#oerr").innerHTML = errBox(e); f.querySelector("button").disabled = false; } };
    }).catch((e) => { const b = el.querySelector("#olink"); if (b) b.innerHTML = errBox(e); });
  }

  // ---- drag and drop (pointer events: mouse + touch)
  let drag = null;
  const targetAt = (x, y) => { const t = document.elementFromPoint(x, y)?.closest("[data-drop]"); return t && el.contains(t) ? t : null; };
  const clear = () => el.querySelectorAll(".dropok,.dropbad").forEach((n) => n.classList.remove("dropok", "dropbad"));
  el.onpointerdown = (ev) => {
    const n = ev.target.closest(".onode"); if (!n || ev.button > 0) return;
    if (ev.pointerType !== "mouse" && !ev.target.closest(".grab")) return;        // touch: only the handle drags, so the page can still scroll
    drag = { id: n.dataset.id, x: ev.clientX, y: ev.clientY, on: false, node: n, bad: descendants(n.dataset.id) }; drag.bad.add(n.dataset.id);
    if (ev.pointerType !== "mouse") { ev.preventDefault(); n.setPointerCapture?.(ev.pointerId); }
  };
  on("pointermove", (ev) => {
    if (!drag || !el.isConnected) return;
    if (!drag.on) { if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 7) return; drag.on = true;
      drag.ghost = drag.node.cloneNode(true); drag.ghost.classList.add("ghost"); document.body.appendChild(drag.ghost); drag.node.classList.add("dragging"); }
    drag.ghost.style.left = ev.clientX + 8 + "px"; drag.ghost.style.top = ev.clientY + 8 + "px";
    clear(); const t = targetAt(ev.clientX, ev.clientY);
    if (t) t.classList.add(t.dataset.top ? "dropok" : drag.bad.has(t.dataset.id) ? "dropbad" : "dropok");
  });
  on("pointerup", async (ev) => {
    if (!drag) return; const d = drag; drag = null;
    if (!d.on) return;
    d.ghost.remove(); d.node.classList.remove("dragging"); const t = targetAt(ev.clientX, ev.clientY); clear();
    el._justDragged = true; setTimeout(() => (el._justDragged = false), 50);
    if (!t) return;
    if (t.dataset.top) { if (byId[d.id].reports_to_id) await setRep(d.id, null, "Moved to the top ✔"); return; }
    if (d.bad.has(t.dataset.id)) return toast("A person cannot report to themselves or to someone below them.", true);
    if (byId[d.id].reports_to_id === t.dataset.id) return;
    await setRep(d.id, t.dataset.id, `${byId[d.id].full_name} now reports to ${byId[t.dataset.id].full_name} ✔`);
  });
  on("pointercancel", () => { if (drag?.ghost) drag.ghost.remove(); drag?.node?.classList.remove("dragging"); clear(); drag = null; });
}
