// Administrator screen: who is who, what access they have (role / department / manager), add people, create roles & departments.
const LEVELS = { 1: "Staff", 2: "Supervisor", 3: "Manager", 4: "HR / Director", 5: "Managing Director" };

export async function renderAdmin(el, { rest, rpc, esc, toast, errBox, userId }) {
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let people, roles, depts, logins;
  try {
    [people, roles, depts, logins] = await Promise.all([ rpc("iaf_admin_users"), rest("roles?is_active=eq.true&select=id,title,level&order=level.desc,title"),
      rest("departments?select=id,name,has_supervisor_tier&order=name"), rpc("iaf_admin_unlinked_logins") ]);
  } catch (e) { el.innerHTML = errBox(e); return; }
  const opt = (rows, val, label, sel, none) => `${none ? `<option value="">${esc(none)}</option>` : ""}${rows.map((r) => `<option value="${esc(r[val])}"${r[val] === sel ? " selected" : ""}>${esc(label(r))}</option>`).join("")}`;
  const roleLabel = (r) => `${r.title} — level ${r.level} (${LEVELS[r.level]})`;
  const statuses = ["active", "on_leave", "suspended", "terminated"];
  const card = (p) => `<div class="card person" data-id="${esc(p.id)}">
      <div class="between"><div><b>${esc(p.full_name)}</b>${p.is_admin ? ` <span class="chip ok">Admin</span>` : ""}<br><small>${esc(p.email || "no login linked")}</small></div>
        <span class="chip ${p.status === "active" ? "ok" : "mute"}">${esc(p.status)}</span></div>
      <p class="s">${esc(p.role_title || "No role")}${p.role_level ? ` (level ${p.role_level})` : ""} · ${esc(p.dept_name || "No department")} · Reports to: ${esc(p.manager_name || "—")}</p>
      <button class="link" data-edit>Edit access</button>
      <form class="form" data-form hidden>
        <label>Role<select name="role">${opt(roles, "id", roleLabel, p.role_id, "— none —")}</select></label>
        <label>Department<select name="dept">${opt(depts, "id", (d) => d.name, p.dept_id, "— none —")}</select></label>
        <label>Reports to (manager)<select name="mgr">${opt(people.filter((x) => x.id !== p.id), "id", (x) => x.full_name, p.manager_id, "— none —")}</select></label>
        <label>Status<select name="status">${statuses.map((s) => `<option${s === p.status ? " selected" : ""}>${s}</option>`).join("")}</select></label>
        <div class="btns"><button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" data-admin="${p.is_admin ? "off" : "on"}">${p.is_admin ? "Remove admin" : "Make admin"}</button></div>
      </form></div>`;
  el.innerHTML = `
    <div class="alert warn"><b>Access levels.</b> The role's level decides what a person can do: 1 Staff · 2 Supervisor · 3 Manager · 4 HR/Director (sees everyone's leave in the company) · 5 Managing Director. “Admin” is separate — it lets someone manage people and access, and does not change their job level.</div>
    <h2>People</h2><div class="list">${people.map(card).join("") || `<div class="empty">No people yet.</div>`}</div>
    <h2>Add a person</h2>
    <form class="card form" id="addp">
      <p class="s">First create their login in Supabase: <b>Authentication → Users → Add user</b> (give an email and password, tick auto-confirm). Then pick it here.</p>
      <label>Login<select name="login" required>${opt(logins, "id", (l) => l.email, null, logins.length ? "— choose a login —" : "— no unlinked logins —")}</select></label>
      <label>Full name<input name="name" required maxlength="80"></label>
      <label>Role<select name="role">${opt(roles, "id", roleLabel, null, "— none —")}</select></label>
      <label>Department<select name="dept">${opt(depts, "id", (d) => d.name, null, "— none —")}</select></label>
      <label>Reports to (manager)<select name="mgr">${opt(people, "id", (x) => x.full_name, null, "— none —")}</select></label>
      <div class="two"><label>VL days this year <span class="opt">(optional)</span><input name="vl" type="number" min="0" step="0.5" inputmode="decimal"></label>
        <label>SL days this year <span class="opt">(optional)</span><input name="sl" type="number" min="0" step="0.5" inputmode="decimal"></label></div>
      <div id="aerr"></div><button class="btn primary block" type="submit">Add person</button></form>
    <h2>Roles</h2><div class="card"><p class="s">${roles.map((r) => `${esc(r.title)} (L${r.level})`).join(" · ") || "No roles yet."}</p>
      <form class="form" id="addr"><div class="two"><label>New role title<input name="title" required maxlength="60" placeholder="e.g. HR Manager"></label>
        <label>Level<select name="level">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === 4 ? " selected" : ""}>${n} — ${LEVELS[n]}</option>`).join("")}</select></label></div>
        <div id="rerr"></div><button class="btn block" type="submit">Create role</button></form></div>
    <h2>Departments</h2><div class="card"><p class="s">${depts.map((d) => esc(d.name)).join(" · ") || "No departments yet."}</p>
      <form class="form" id="addd"><label>New department<input name="name" required maxlength="60"></label>
        <label class="chk"><input type="checkbox" name="sup"> Has a Supervisor tier (leave goes Supervisor → Manager)</label>
        <div id="derr"></div><button class="btn block" type="submit">Create department</button></form></div>`;
  const reload = () => renderAdmin(el, { rest, rpc, esc, toast, errBox, userId });
  const nz = (v) => v || null;
  const guard = async (btn, errId, fn, okMsg) => { btn.disabled = true; const eb = errId && el.querySelector(errId); if (eb) eb.innerHTML = "";
    try { await fn(); toast(okMsg); await reload(); } catch (e) { if (eb) eb.innerHTML = errBox(e); else toast(e.message, true); btn.disabled = false; } };
  el.onclick = (ev) => {
    const c = ev.target.closest(".person"); if (!c) return; const id = c.dataset.id;
    if (ev.target.closest("[data-edit]")) c.querySelector("[data-form]").hidden = !c.querySelector("[data-form]").hidden;
    const ab = ev.target.closest("[data-admin]");
    if (ab && confirm(ab.dataset.admin === "on" ? "Make this person an administrator?" : "Remove administrator access?"))
      guard(ab, null, () => rpc("iaf_admin_set_admin", { p_user_id: id, p_is_admin: ab.dataset.admin === "on" }), "Updated ✔");
  };
  el.onsubmit = (ev) => {
    ev.preventDefault(); const f = ev.target, btn = f.querySelector("button[type=submit]");
    if (f.matches("[data-form]")) { const id = f.closest(".person").dataset.id;
      return guard(btn, null, () => rpc("iaf_admin_set_user", { p_user_id: id, p_role_id: nz(f.role.value), p_dept_id: nz(f.dept.value), p_manager_id: nz(f.mgr.value), p_status: f.status.value }), "Saved ✔"); }
    if (f.id === "addp") return guard(btn, "#aerr", () => rpc("iaf_admin_link_user", { p_login_id: f.login.value, p_full_name: f.name.value.trim(), p_role_id: nz(f.role.value), p_dept_id: nz(f.dept.value), p_manager_id: nz(f.mgr.value),
      p_vl_days: f.vl.value === "" ? null : Number(f.vl.value), p_sl_days: f.sl.value === "" ? null : Number(f.sl.value) }), "Person added ✔");
    if (f.id === "addr") return guard(btn, "#rerr", () => rpc("iaf_admin_create_role", { p_title: f.title.value.trim(), p_level: Number(f.level.value) }), "Role created ✔");
    if (f.id === "addd") return guard(btn, "#derr", () => rpc("iaf_admin_create_department", { p_name: f.name.value.trim(), p_has_supervisor_tier: !!f.sup.checked }), "Department created ✔");
  };
}
