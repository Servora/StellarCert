export interface ParseCsvOptions {
  trimHeaders?: boolean;
}

/**
 * Parses a CSV string conforming to RFC 4180 into an array of row objects keyed by header names.
 * Supports quoted fields, escaped quotes (""), multiline fields, and CRLF / LF line endings.
 */
export function parseCsv(
  csvText: string,
  options: ParseCsvOptions = { trimHeaders: true },
): Record<string, string>[] {
  if (!csvText || typeof csvText !== 'string') {
    return [];
  }

  // Remove Byte Order Mark (BOM) if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  // Push the final cell and row if anything remains
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  // Filter out any completely empty rows
  const nonEmptyRows = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmptyRows.length === 0) {
    return [];
  }

  const headerRow = nonEmptyRows[0];
  const headers = headerRow.map((h) =>
    options.trimHeaders !== false ? h.trim() : h,
  );

  const results: Record<string, string>[] = [];
  for (let r = 1; r < nonEmptyRows.length; r++) {
    const row = nonEmptyRows[r];
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      let val = row[c] ?? '';
      // Strip formula trigger leading apostrophe if added by exporter
      if (val.startsWith("'") && ['=', '+', '-', '@', '\t', '\r'].includes(val[1])) {
        val = val.slice(1);
      }
      record[header] = val;
    }
    results.push(record);
  }

  return results;
}
