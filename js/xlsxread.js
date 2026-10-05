// Dependency-free reader for .xlsx (zip + XML) and .csv, and the column mapper for the employee import.
// Works in the browser and in Node 18+ (uses DecompressionStream("deflate-raw")).

const td = new TextDecoder();
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  const out = []; const r = ds.readable.getReader(); let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; out.push(value); n += value.length; }
  const res = new Uint8Array(n); let p = 0; for (const c of out) { res.set(c, p); p += c.length; }
  return res;
}

// -> { "xl/workbook.xml": Uint8Array, ... } (only entries we ask for are inflated, lazily)
function zipEntries(buf) {
  const b = new Uint8Array(buf); let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("This does not look like an Excel (.xlsx) file.");
  const count = u16(b, e + 10); let p = u32(b, e + 16); const map = {};
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    map[name] = async () => {
      const lnl = u16(b, lho + 26), lxl = u16(b, lho + 28), start = lho + 30 + lnl + lxl, data = b.subarray(start, start + csize);
      return method === 0 ? data : inflateRaw(data);
    };
    p += 46 + nlen + xlen + clen;
  }
  return map;
}

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const attr = (s, n) => { const m = new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(s); return m ? unxml(m[1]) : null; };
const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const serialToISO = (n) => { const d = new Date(Math.round((n - 25569) * 86400000)); return d.toISOString().slice(0, 10); };

// xlsx -> array of sheets { name, rows: (string|number|null)[][] }; dates become "YYYY-MM-DD"
export async function readXlsx(buf) {
  const z = zipEntries(buf), get = async (n) => (z[n] ? td.decode(await z[n]()) : null);
  const wb = await get("xl/workbook.xml"); if (!wb) throw new Error("This does not look like an Excel (.xlsx) file.");
  const rels = (await get("xl/_rels/workbook.xml.rels")) || "";
  const relMap = {}; for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) relMap[attr(m[1], "Id")] = attr(m[1], "Target");
  const strings = []; const ss = await get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) strings.push(unxml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  // styles -> which cell formats are dates
  const dateXf = []; const st = await get("xl/styles.xml");
  if (st) {
    const custom = {}; for (const m of st.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom[attr(m[1], "numFmtId")] = attr(m[1], "formatCode") || "";
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st);
    if (xfs) for (const m of xfs[1].matchAll(/<xf\b([^>]*)\/?>/g)) {
      const id = attr(m[1], "numFmtId"), code = custom[id];
      dateXf.push(DATE_IDS.has(+id) || (code != null && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^0|#/.test(code)));
    }
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name"), rid = attr(m[1], "r:id"); let target = relMap[rid]; if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const xml = await get(target); if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rn = +attr(rm[1], "r") - 1, cells = []; if (!rm[2]) continue;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], "r"), t = attr(cm[1], "t"), s = attr(cm[1], "s"), body = cm[2] || "";
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body); let v = null;
        if (t === "inlineStr") v = unxml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else if (vm) {
          const raw = unxml(vm[1]);
          if (t === "s") v = strings[+raw]; else if (t === "str" || t === "e") v = t === "e" ? null : raw; else if (t === "b") v = raw === "1" ? 1 : 0;
          else { const num = Number(raw); v = Number.isFinite(num) ? (s != null && dateXf[+s] ? serialToISO(num) : num) : raw; }
        }
        if (v !== null && v !== "") cells[colNum(ref)] = v;
      }
      rows[rn] = cells;
    }
    sheets.push({ name, rows: Array.from(rows, (r) => r || []) });
  }
  return sheets;
}

export function readCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((v) => (v === "" ? null : v)));
}

export async function readAnyFile(file) {
  const buf = await file.arrayBuffer(), nm = (file.name || "").toLowerCase();
  if (nm.endsWith(".csv")) return [{ name: "CSV", rows: readCsv(td.decode(buf)) }];
  return readXlsx(buf);
}

// ---------------------------------------------------------------------------------------------
// Column mapping. Looks for the header row (the one holding "Name" and "Position"), then maps columns by header text.
// Works for the plant salary worksheets and for the plain template (name, position, department, hire date ...).
// ---------------------------------------------------------------------------------------------
const norm = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : Number(String(v).replace(/[,₱\s]/g, "")); return Number.isFinite(n) ? n : null; };
const isoDate = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v > 20000 && v < 80000 ? serialToISO(v) : null;
  const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;   // US style m/d/yyyy
  const d = new Date(s); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10); };
const text = (v) => (v == null ? "" : String(v).trim());


// ---------------------------------------------------------------------------------------------
// 201 file columns: one list drives the template, the export and the upload mapping.
// kind: text | date | time | bool | enum | num | gov
// ---------------------------------------------------------------------------------------------
export const COLS201 = [
  { key: "middle_name", header: "Middle Name", re: /^middle/, kind: "text" },
  { key: "status", header: "Status", re: /^status$/, kind: "enum", ex: ["active", "active"] },
  { key: "sex", header: "Sex", re: /^(sex|gender)$/, kind: "enum", ex: ["male", "female"] },
  { key: "birth_date", header: "Birth Date", re: /^(birth ?date|date of birth|birthday|dob)/, kind: "date", ex: ["1990-04-12", "1994-11-02"] },
  { key: "civil_status", header: "Civil Status", re: /^civil status/, kind: "enum", ex: ["married", "single"] },
  { key: "mobile", header: "Mobile", re: /^(mobile|cellphone|cell no|contact no|contact number)/, kind: "text", ex: ["09171234567", ""] },
  { key: "personal_email", header: "Personal Email", re: /^(personal e-?mail|e-?mail( address)?)$/, kind: "text" },
  { key: "present_address", header: "Present Address", re: /^(present|current) address/, kind: "text" },
  { key: "permanent_address", header: "Permanent Address", re: /^(permanent|home) address/, kind: "text" },
  { key: "emergency_name", header: "Emergency Contact", re: /^emergency (contact( name)?|name)$/, kind: "text" },
  { key: "emergency_relation", header: "Emergency Relationship", re: /^emergency (contact )?relation/, kind: "text" },
  { key: "emergency_mobile", header: "Emergency Mobile", re: /^emergency (contact )?(mobile|number|phone|no)/, kind: "text" },
  { key: "employment_type", header: "Employment Type", re: /^(employment|employee) type/, kind: "enum", ex: ["regular", "probationary"] },
  { key: "regularization_date", header: "Regularization Date", re: /^regularization/, kind: "date" },
  { key: "shift_start", header: "Shift Start", re: /^shift start/, kind: "time", ex: ["08:00", "07:00"] },
  { key: "shift_end", header: "Shift End", re: /^shift end/, kind: "time", ex: ["17:00", "18:00"] },
  { key: "daily_hours", header: "Daily Hours", re: /^(daily|work) hours|^hours per day/, kind: "num", ex: ["8", "9"] },
  { key: "company_email", header: "Company Email", re: /^(company|work) e-?mail/, kind: "text" },
  { key: "sss", header: "SSS No", re: /^sss/, kind: "gov" },
  { key: "philhealth", header: "PhilHealth No", re: /^phil ?health/, kind: "gov" },
  { key: "pagibig", header: "Pag-IBIG No", re: /^(pag-?ibig|hdmf)/, kind: "gov" },
  { key: "tin", header: "TIN", re: /^tin/, kind: "gov" },
  { key: "spouse_name", header: "Spouse Name", re: /^spouse/, kind: "text" },
  { key: "marriage_cert_on_file", header: "Marriage Cert On File", re: /^marriage cert/, kind: "bool", ex: ["yes", ""] },
  { key: "solo_parent", header: "Solo Parent", re: /^solo parent$/, kind: "bool", ex: ["no", "yes"] },
  { key: "spic_no", header: "SPIC No", re: /^(spic (no|number)|solo parent (id|card))/, kind: "text" },
  { key: "spic_valid_until", header: "SPIC Valid Until", re: /^(spic valid|solo parent (id|card) valid)/, kind: "date" },
  { key: "solo_verified", header: "Solo Parent Verified By HR", re: /^solo parent verified/, kind: "bool" },
  { key: "prior_paternity_count", header: "Prior Paternity Count", re: /^prior paternity/, kind: "num", ex: ["1", ""] },
  { key: "edu_attainment", header: "Education", re: /^(education|educational attainment)/, kind: "text" },
  { key: "edu_course", header: "Course", re: /^course/, kind: "text" },
  { key: "separation_date", header: "Separation Date", re: /^(separation date|date separated)/, kind: "date" },
  { key: "last_day_worked", header: "Last Day Worked", re: /^last day/, kind: "date" },
  { key: "separation_type", header: "Separation Type", re: /^separation type/, kind: "enum" },
  { key: "separation_reason", header: "Separation Reason", re: /^(separation )?reason/, kind: "text" },
  { key: "clearance_done", header: "Clearance Done", re: /^clearance/, kind: "bool" },
  { key: "final_pay_released", header: "Final Pay Released", re: /^final pay/, kind: "bool" },
  { key: "rehire_eligible", header: "Rehire Eligible", re: /^(eligible for )?rehire/, kind: "bool" },
];
const timeStr = (v) => { if (v == null || v === "") return null; if (typeof v === "number") { if (v > 0 && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; } return String(v); } return String(v).trim() || null; };
const cell201 = (c, v) => { if (v == null || v === "") return null;
  if (c.kind === "date") return isoDate(v); if (c.kind === "time") return timeStr(v);
  if (typeof v === "number") { if (c.key.endsWith("mobile") || c.key === "mobile") { const s = String(Math.trunc(v)); return /^9\d{9}$/.test(s) ? "0" + s : s; } return String(v); }
  return text(v) || null; };

export function mapEmployeeRows(grid) {
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const h = (grid[i] || []).map(norm);
    if (h.some((x) => x === "name" || x === "full name" || x === "employee name") && h.some((x) => x === "position" || x === "job title" || x === "title")) { hi = i; break; }
  }
  if (hi < 0) throw new Error('Could not find the header row. The sheet needs columns called "Name" and "Position".');
  const h1 = (grid[hi] || []).map(norm), h2 = (grid[hi + 1] || []).map(norm), width = Math.max(h1.length, h2.length);
  const find = (re, from = 0, skip = []) => { for (let c = from; c < width; c++) if (!skip.includes(c) && re.test(h1[c] || "")) return c; return -1; };
  const col = {};
  col.name = find(/^(name|full name|employee name)$/); col.position = find(/^(position|job title|title)$/);
  col.department = find(/^(department|dept|company\/location|location)$/); col.hire = find(/^hire date|^date hired|^date of hire/);
  col.empno = find(/^(employee no|employee number|emp no|employee id|id no)/);
  col.lastInc = find(/^last salary increase/); col.lastPromo = find(/^last promotion/); col.incType = find(/^type of increase/);
  col.basic = find(/^basic salary/); col.allow = find(/^(performance )?allowance/);
  col.merit = find(/^merit/); col.newBasic = find(/^new basic/);
  col.newAllow = col.newBasic >= 0 ? find(/^allowance/, col.newBasic) : -1;
  col.newPos = find(/new position/); col.remarks = find(/^remarks/);
  const c201 = COLS201.map((c) => [c, find(c.re)]);
  for (const [c, idx] of c201) col[c.key] = idx;
  const dataStart = hi + 1 + (h2.some((x) => /^(monthly|annual|%|amount)/.test(x)) ? 1 : 0);
  const rows = [];
  for (let i = dataStart; i < grid.length; i++) {
    const r = grid[i] || [], g = (c) => (c >= 0 ? r[c] : null), name = text(g(col.name));
    if (!name) continue;
    rows.push({ name, position: text(g(col.position)), department: text(g(col.department)), hire_date: isoDate(g(col.hire)), employee_no: text(g(col.empno)) || null,
      basic: num(g(col.basic)), allowance: num(g(col.allow)), last_increase_date: isoDate(g(col.lastInc)), last_promotion_date: isoDate(g(col.lastPromo)),
      increase_type: text(g(col.incType)) || null, merit_pct: num(g(col.merit)), new_basic: num(g(col.newBasic)), new_allowance: num(g(col.newAllow)),
      new_position: text(g(col.newPos)) || null, remarks: text(g(col.remarks)) || null });
    for (const [c, idx] of c201) { if (idx < 0) continue; const v = cell201(c, r[idx]); if (v != null) rows[rows.length - 1][c.key] = v; }
  }
  return { rows, found: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v >= 0])) };
}

// Suggest merging a misspelled department into a more common one (edit distance <= 2).
export function suggestDeptMap(counts) {
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]), map = {};
  for (const n of names) { const better = names.find((m) => m !== n && counts[m] > counts[n] && n.length > 4 && lev(n.toLowerCase(), m.toLowerCase()) <= 2); if (better) map[n] = better; }
  return map;
}


// ---------------------------------------------------------------------------------------------
// Children / deliveries sheet: Employee No, Name, Child Name, Date, Type, Birth Cert On File
// ---------------------------------------------------------------------------------------------
export function mapChildrenRows(grid) {
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) { const h = (grid[i] || []).map(norm); if (h.some((x) => /^child/.test(x)) && h.some((x) => /date/.test(x))) { hi = i; break; } }
  if (hi < 0) throw new Error('Could not find the header row. The sheet needs columns "Child Name" and "Birth / Miscarriage Date".');
  const h = (grid[hi] || []).map(norm), at = (re) => h.findIndex((x) => re.test(x));
  const c = { no: at(/^employee (no|number)|^emp no/), name: at(/^(name|employee name|full name)$/), child: at(/^child/), date: at(/date/), type: at(/^type/), cert: at(/cert/) };
  const rows = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || [], g = (k) => (k >= 0 ? r[k] : null);
    if (!text(g(c.no)) && !text(g(c.name))) continue;
    rows.push({ employee_no: text(g(c.no)) || null, name: text(g(c.name)), child_name: text(g(c.child)) || null, event_date: isoDate(g(c.date)), event_type: text(g(c.type)) || null, birth_cert_on_file: text(g(c.cert)) || null });
  }
  return rows;
}
