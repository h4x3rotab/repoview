export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let current = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        current.push(cell);
        cell = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        if (ch === "\r") i++;
        current.push(cell);
        rows.push(current);
        current = [];
        cell = "";
      } else if (ch === "\r") {
        current.push(cell);
        rows.push(current);
        current = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell || current.length) {
    current.push(cell);
    rows.push(current);
  }
  return rows;
}

export function renderCsvTable(rows, escFn) {
  if (!rows.length) return "<p>Empty file</p>";
  const header = rows[0];
  const body = rows.slice(1);
  const ths = header.map((h) => `<th>${escFn(h)}</th>`).join("");
  const trs = body
    .map((row) => `<tr>${row.map((c) => `<td>${escFn(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<div class="csv-table-wrap"><table class="csv-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}
