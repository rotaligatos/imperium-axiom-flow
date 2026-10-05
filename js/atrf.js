// Draws the standard Attendance Transaction Request Form (FO-HRMD-14 v2.0), two copies on one landscape A4 page.
import { Pdf } from "./pdf.js";
import { LOGO_WCLI } from "./pdfdata.js";

const W = 396, GREY = [217, 217, 217], YEL = [255, 255, 153];
const LEAVES = [
  ["vl", "Vacation Leave"], ["sl", "Sick Leave", "(Med Cert >2 days)"], ["bday", "Birthday Leave"], ["sil", "Service Incentive Leave (SIL)"],
  ["solo", "(SIL) Solo Parent Leave"], ["bereave", "Bereavement Leave", "(Proof)"], ["matpat", "Maternity / Paternity Leave"],
  ["wom", "Special Leave for Women (RA 9710)"], ["vawc", "VAWC Leave (RA 9262)"], ["unpaid", "Leave of Absence (Unpaid)"] ];

export const fmtDate = (d) => { if (!d) return ""; const x = new Date(/^\d{4}-\d\d-\d\d$/.test(d) ? d + "T00:00:00" : d); if (isNaN(x)) return String(d);
  return `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}/${x.getFullYear()}`; };
export const fmtWhen = (d) => { if (!d) return ""; const x = new Date(d); if (isNaN(x)) return ""; return `${fmtDate(x)} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };

function copy(p, ox, oy, d) {
  const X = (x) => ox + x, Y = (y) => oy + y;
  const box = (x, y, w, h, o) => p.rect(X(x), Y(y), w, h, o);
  const hl = (x1, x2, y) => p.line(X(x1), Y(y), X(x2), Y(y), 0.6);
  const t = (s, x, y, o) => p.text(s, X(x), Y(y), o);
  const bar = (y, label) => { box(0, y, W, 10.5, { fill: GREY }); t(label, 3, y + 7.8, { size: 7, bold: true }); };
  const field = (label, val, x, y, w) => { t(label, x, y, { size: 7, bold: true }); const lx = x + p.width(label, 7, true) + 3;
    hl(lx, x + w, y + 1.5); t(p.fit(val, 7.5, false, x + w - lx - 2), lx + 1, y - 0.5, { size: 7.5 }); };
  const sig = (s, cx, lineY, w) => {            // signature stamp centred above a line
    hl(cx - w / 2, cx + w / 2, lineY);
    if (!s) return;
    const stamp = `Signed with device ${s.method || "biometric/PIN"} - ${fmtWhen(s.when)}`;
    if (s.img) {                                  // drawn signature image + small name/verification text
      const ih = 19, iw = Math.min(w * 0.5, ih * (s.img.w / s.img.h));
      p.image(s.img, X(cx - w / 2 + 2), Y(lineY - ih - 0.5), iw, ih);
      const tx = cx - w / 2 + iw + 6;
      t(p.fit(s.name, 7, true, w - iw - 8), tx, lineY - 9, { size: 7, bold: true });
      t(p.fit(stamp, 4.6, false, w - iw - 8), tx, lineY - 3.5, { size: 4.6, rgb: [60, 60, 60] });
      return;
    }
    t(p.fit(s.name, 8, true, w), cx, lineY - 11, { size: 8, bold: true, align: "center" });
    t(p.fit(stamp, 5.2, false, w + 30), cx, lineY - 4.2, { size: 5.2, align: "center", rgb: [60, 60, 60] });
  };

  // Outer frame + header
  box(0, 0, W, 459.5);
  box(0, 0, 131, 30); box(131, 0, 167.5, 30); box(298.5, 0, 97.5, 30);
  if (d.companyCode === "WCLI") p.image(Pdf.__logo ||= Pdf.logo(LOGO_WCLI), X(10), Y(3), 40, 24.7), t("WORLD CLASS", 53, 17, { size: 6.2, bold: true }), t("LAMINATE INC.", 53, 24, { size: 6.2, bold: true });
  else t(p.fit(d.companyName.toUpperCase(), 8, true, 120), 65.5, 17, { size: 8, bold: true, align: "center" });
  t("ATTENDANCE TRANSACTION", 214.7, 13, { size: 8.5, bold: true, align: "center" }); t("REQUEST FORM", 214.7, 22.5, { size: 8.5, bold: true, align: "center" });
  hl(298.5, W, 10); hl(298.5, W, 20);
  t("Form Code:", 301, 7.5, { size: 5.8, bold: true }); t("FO-HRMD-14", 301 + p.width("Form Code: ", 5.8, true), 7.5, { size: 5.8 });
  t("Version:", 301, 17.5, { size: 5.8, bold: true }); t("2.0", 301 + p.width("Version: ", 5.8, true), 17.5, { size: 5.8 });
  t("Date:", 301, 27.5, { size: 5.8, bold: true }); t("09/15/2026", 301 + p.width("Date: ", 5.8, true), 27.5, { size: 5.8 });

  // 1. Employee details
  bar(30, "1. EMPLOYEE DETAILS");
  box(0, 40.5, W, 14); box(0, 54.5, W, 14.5); p.line(X(198), Y(40.5), X(198), Y(69), 0.6);
  field("NAME:", d.name, 3, 50.5, 190); field("DATE FILED:", fmtDate(d.dateFiled), 201, 50.5, 190);
  field("DESIGNATION:", d.designation, 3, 65, 190); field("DEPARTMENT:", d.department, 201, 65, 190);

  // 2. Transaction details & type
  bar(69, "2. TRANSACTION DETAILS & TYPE");
  box(0, 79.5, W, 123.5); p.line(X(198), Y(79.5), X(198), Y(203), 0.6);
  t("LEAVES & TIME-OFF", 3, 89, { size: 7, bold: true });
  LEAVES.forEach(([k, label, sub], i) => { const y = 94 + i * 10.7;
    p.check(X(4), Y(y), 6.2, !!d.types?.[k]); t(label, 13, y + 5.6, { size: 7 });
    if (sub) t(sub, 13 + p.width(label + " ", 7, false), y + 5.6, { size: 5 }); });
  t("OTHERS:", 201, 89, { size: 7, bold: true });
  p.check(X(203), Y(93), 6.2, !!d.types?.wfh); t("Work From Home", 212, 98.6, { size: 7 });
  p.check(X(203), Y(104), 6.2, !!d.types?.ob); t("Official Business (OB)", 212, 109.6, { size: 7 });
  t("OB IN: ________  OUT: ________", 205, 121, { size: 6.2 });
  p.check(X(203), Y(126), 6.2, false); t("Halfday Time: ____ - ____", 212, 131.6, { size: 7 });
  p.check(X(203), Y(137), 6.2, false); t("Undertime Time: ____ - ____", 212, 142.6, { size: 7 });
  p.check(X(203), Y(148), 6.2, false); t("NO BIO", 212, 153.8, { size: 7.5, bold: true });
  box(205, 160, 186, 37, { stroke: [150, 150, 150], lw: 0.4 });
  t("Date: ________  In: _____ Out: _____", 209, 173, { size: 6.2, rgb: [90, 90, 90] }); t("Reason: ____________________", 209, 187, { size: 6.2, rgb: [90, 90, 90] });
  // purpose + from/to (as on the template)
  const sched = (y0) => { /* purpose lines */ };  void sched;
  box(0, 203, W, 25); t("PURPOSE:", 3, 212, { size: 7, bold: true });
  p.wrap(d.purpose || "", 7.5, false, W - 66).slice(0, 2).forEach((l, i) => t(l, 44, 212 + i * 9.5, { size: 7.5 }));
  hl(44, W - 4, 213.5); hl(3, W - 4, 223);
  box(0, 228, W, 15); fromTo(228 + 10, d);

  function fromTo(y, v) {
    t("FROM (Date/Time):", 3, y, { size: 7, bold: true }); const a = 3 + p.width("FROM (Date/Time): ", 7, true); hl(a, a + 70, y + 1.5); t(v.from || "", a + 2, y - 0.5, { size: 7.5 });
    const b = a + 78; t("TO:", b, y, { size: 7, bold: true }); const b2 = b + p.width("TO: ", 7, true); hl(b2, b2 + 70, y + 1.5); t(v.to || "", b2 + 2, y - 0.5, { size: 7.5 });
    const c = b2 + 78; t("TOTAL DAYS/HRS:", c, y, { size: 7, bold: true }); const c2 = c + p.width("TOTAL DAYS/HRS: ", 7, true); hl(c2, W - 6, y + 1.5); t(v.total || "", c2 + 2, y - 0.5, { size: 7.5 });
  }

  // 3. Schedule & purpose
  bar(243, "3. SCHEDULE & PURPOSE");
  // Section 3 is only for OB / WFH requests; for leaves it stays blank (leave details live in Section 2).
  const obwfh = !!(d.types?.ob || d.types?.wfh), sec3 = obwfh ? d : {};
  box(0, 253.5, W, 13.5); field("DESTINATION (OB/WFH):", sec3.destination || "", 3, 263, W - 8);
  box(0, 267, W, 22); t("PURPOSE:", 3, 276, { size: 7, bold: true });
  p.wrap(sec3.purpose || "", 7.5, false, W - 66).slice(0, 2).forEach((l, i) => t(l, 44, 276 + i * 9, { size: 7.5 }));
  hl(44, W - 4, 277.5); hl(3, W - 4, 286);
  box(0, 289, W, 14); fromTo(289 + 9.5, sec3);

  // 4. Sign-off & approvals
  bar(303, "4. SIGN-OFF & APPROVALS");
  box(0, 313.5, W, 32.5); p.line(X(198), Y(313.5), X(198), Y(346), 0.6);
  t("Prepared by:", 3, 322, { size: 7.5, bold: true });
  sig(d.employeeSig, 99, 337, 140); t("Employee's Signature", 99, 344, { size: 7, bold: true, align: "center" });
  t("Decision:", 202, 322, { size: 7.5, bold: true });
  p.check(X(240), Y(316.3), 7, d.decision === "APPROVED"); t("Approved", 250, 322, { size: 7.5, bold: true });
  p.check(X(288), Y(316.3), 7, d.decision === "REJECTED"); t("Disapproved", 298, 322, { size: 7.5, bold: true });
  box(0, 346, W, 31); t("Disapproval Reason:", 3, 355, { size: 7.5, bold: true });
  [["Late Filing", 4], ["Late Advice", 62], ["No Advice", 122], ["Operational necessity", 175], ["Other:", 262]].forEach(([l, x]) => { p.check(X(x), Y(360), 6, false); t(l, x + 8.5, 365.6, { size: 6.5 }); });
  hl(300, W - 4, 367); if (d.decision === "REJECTED") { p.check(X(262), Y(360), 6, true); t(p.fit(d.rejectReason || "", 6.5, false, W - 306), 302, 365.4, { size: 6.5 }); }
  box(0, 377, W, 29); p.line(X(198), Y(377), X(198), Y(406), 0.6);
  sig(d.approverSig, 99, 397, 150); t("Supervisor / Dept. Head Signature", 99, 404, { size: 7, bold: true, align: "center" });
  hl(222, 372, 397); if (d.decision) t(fmtDate(d.dateActioned), 297, 394, { size: 8, align: "center" }); t("Date Actioned", 297, 404, { size: 7, bold: true, align: "center" });

  // 5. HRMD & payroll processing
  bar(406, "5. HRMD & PAYROLL PROCESSING");
  box(0, 416.5, W, 43); p.line(X(120), Y(416.5), X(120), Y(459.5), 0.6); p.line(X(198), Y(416.5), X(198), Y(459.5), 0.6); p.line(X(332), Y(416.5), X(332), Y(459.5), 0.6);
  t("Received by:", 3, 426, { size: 7.5, bold: true }); sig(d.hrSig, 60, 448, 100); t("HRMD", 60, 456.5, { size: 7, bold: true, align: "center" });
  t("Date :", 124, 426, { size: 7.5, bold: true }); hl(124, 194, 448);
  if (d.hrSig) t(fmtDate(d.hrSig.when), 159, 445, { size: 7.5, align: "center" });
  box(201, 420, 128, 22, { fill: YEL, stroke: [0, 0, 0], lw: 0.5 });
  t("* REMAINING BALANCES *", 265, 428.5, { size: 6.5, bold: true, align: "center" });
  t(`VL: ${d.balVL ?? "______"}      SL: ${d.balSL ?? "______"}`, 265, 438, { size: 7.5, bold: true, align: "center" });
  const cs = Math.min(12, 58 / Math.max(1, p.width(d.controlNo || "", 1, true))); t(d.controlNo || "", 364, 443, { size: cs, bold: true, align: "center" });
}

// d = request data (see copy()); returns Uint8Array of a one-page A4 PORTRAIT PDF with a single copy of the form.
export function buildAtrfPdf(d) {
  const p = new Pdf(595.28, 841.89); p.k = 1.36;
  copy(p, 28 / p.k, 40 / p.k, d);
  p.text(`${d.companyName} - generated by Imperium Axiom Flow - ref ${d.ref || ""}`, 595.28 / 2 / p.k, 800 / p.k, { size: 6, align: "center", rgb: [120, 120, 120] });
  return p.build({ title: `FO-HRMD-14 ${d.ref || ""} ${d.name || ""}` });
}
