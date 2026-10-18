/**
 * CSV serialisation helpers shared by every exporter.
 *
 * Two concerns are handled here so that all exports behave the same way:
 *
 *  - RFC 4180 escaping: each field is quoted and any embedded double quote is
 *    doubled, so commas, quotes and newlines in a value survive a round trip
 *    through a spreadsheet instead of breaking the column layout.
 *  - Formula-injection neutralisation: a field whose text begins with a
 *    spreadsheet formula trigger (`=`, `+`, `-`, `@`, a tab or a carriage
 *    return) is prefixed with a single quote. Without this, user-controlled
 *    values such as a recipient name or certificate title can be evaluated as
 *    a formula when the CSV is opened in Excel, Sheets or LibreOffice.
 */

/** Characters that make spreadsheet software treat a cell as a formula. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * Serialises a single value for use as a CSV field.
 *
 * `null` and `undefined` become an empty field; every value is quoted and its
 * embedded quotes are doubled; formula-leading text is prefixed with `'`.
 */
export function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const neutralised = FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))
    ? `'${text}`
    : text;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

/** Serialises one CSV record without a trailing newline. */
export function toCsvRow(cells: readonly unknown[]): string {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Serialises a header row and data rows into a CSV document.
 *
 * Line endings are `\n`, matching the exporters this helper replaces.
 */
export function toCsv(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
): string {
  return [toCsvRow(headers), ...rows.map(toCsvRow)].join('\n');
}
