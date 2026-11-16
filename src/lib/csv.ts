/**
 * One CSV writer for every export in the app.
 *
 * Two rules, always:
 *   · fields are quoted and embedded quotes doubled (RFC 4180);
 *   · a cell whose first character could start a spreadsheet formula is
 *     prefixed with a single quote, so a hostile value (`=cmd|…`,
 *     `+HYPERLINK(…)`, `@SUM(1,1)`) opens as inert text instead of
 *     executing when an operator or fabricator opens the file.
 */

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Escape one cell: neutralise spreadsheet formulas, then quote only when the
 * value needs it (comma, quote, newline, edge space) — most machine parsers
 * split on plain commas and choke on unnecessary quotes.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  // A leading tab/CR is itself a formula-hiding trick in some parsers.
  if (text.length > 0 && FORMULA_LEADERS.has(text[0])) {
    text = `'${text}`
  }
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Join one row of cells. */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',')
}

/** A whole document from a header row plus data rows, CRLF line endings. */
export function toCsv(header: readonly unknown[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n')
}
