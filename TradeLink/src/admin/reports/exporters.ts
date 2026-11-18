import { zipSync, strToU8 } from "fflate";

export type Col = { key: string; label: string; get?: (row: Record<string, unknown>) => string | number };
type Cell = string | number;

const cell = (c: Col, r: Record<string, unknown>): Cell => (c.get ? c.get(r) : ((r[c.key] ?? "") as Cell));
export const toMatrix = (cols: Col[], rows: Record<string, unknown>[]): Cell[][] => rows.map(r => cols.map(c => cell(c, r)));

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safe = (s: string) => s.replace(/[^\w\-]+/g, "_").toLowerCase();
export const fileName = (title: string, ext: string) => `tradelink_${safe(title)}_${new Date().toISOString().slice(0, 10)}.${ext}`;

/** Guards against spreadsheet formula injection from user-entered text. */
const defuse = (v: Cell): Cell => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);

export function exportCSV(title: string, cols: Col[], rows: Record<string, unknown>[]) {
  const esc = (v: Cell) => { const s = String(defuse(v)); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(c => esc(c.label)).join(","), ...toMatrix(cols, rows).map(r => r.map(esc).join(","))];
  save(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), fileName(title, "csv"));
}

const xml = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function colName(i: number) { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

/** Minimal, dependency-light .xlsx writer (one sheet, bold header, numbers stay numbers). */
export function exportXLSX(title: string, cols: Col[], rows: Record<string, unknown>[]) {
  const data = [cols.map(c => c.label), ...toMatrix(cols, rows)];
  const sheet = data.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${ri === 0 ? ' s="1"' : ""}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(String(v ?? ""))}</t></is></c>`;
  }).join("") + "</row>").join("");
  const widths = cols.map((c, i) => Math.min(48, Math.max(c.label.length, ...data.slice(1, 200).map(r => String(r[i] ?? "").length)) + 2));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(title.slice(0, 28) || "Report")}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheet}</sheetData></worksheet>`),
  };
  save(new Blob([zipSync(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName(title, "xlsx"));
}

/** PDF is loaded on demand so the library never weighs down the rest of the admin. */
export async function exportPDF(title: string, subtitle: string, cols: Col[], rows: Record<string, unknown>[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: cols.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(16); doc.setTextColor(11, 31, 58); doc.text(`TradeLink — ${title}`, 40, 42);
  doc.setFontSize(9); doc.setTextColor(110, 120, 140); doc.text(`${subtitle}  ·  Generated ${new Date().toLocaleString()}  ·  ${rows.length} rows`, 40, 58);
  autoTable(doc, {
    startY: 72, head: [cols.map(c => c.label)], body: toMatrix(cols, rows).map(r => r.map(String)),
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59] }, headStyles: { fillColor: [11, 31, 58], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 247, 253] }, margin: { left: 40, right: 40 },
  });
  doc.save(fileName(title, "pdf"));
}
