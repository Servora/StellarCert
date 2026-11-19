/**
 * Checks a bulk-export response before it is turned into a download.
 *
 * The API returns the export as a Blob, but a 200 response can still carry
 * something that is not a CSV: a JSON error body, an HTML error page from a
 * proxy, or nothing at all. Downloading those would hand the user a garbage
 * file with no feedback, so the table validates first and shows a reason.
 */
export class InvalidExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExportError';
  }
}

const CSV_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
  '',
]);

function readText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read export'));
    reader.readAsText(blob);
  });
}

/** The human-readable message from a JSON error body, if it has one. */
function messageFromJson(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message = body?.message ?? body?.error;
    if (Array.isArray(message)) return message.map(String).join(', ');
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Not JSON after all.
  }
  return undefined;
}

/**
 * Resolves when `blob` looks like a CSV export; rejects with an
 * {@link InvalidExportError} carrying a message fit to show to the user.
 */
export async function assertValidCsvExport(blob: Blob): Promise<void> {
  if (!blob || blob.size === 0) {
    throw new InvalidExportError('The export was empty. No file was downloaded.');
  }

  const type = (blob.type || '').split(';')[0].trim().toLowerCase();

  if (type === 'application/json' || type.endsWith('+json')) {
    const reason = messageFromJson(await readText(blob));
    throw new InvalidExportError(
      reason
        ? `The server returned an error instead of a file: ${reason}`
        : 'The server returned an error instead of a file.',
    );
  }
  if (type === 'text/html') {
    throw new InvalidExportError('The server returned a web page instead of a CSV file.');
  }
  if (!CSV_TYPES.has(type)) {
    throw new InvalidExportError(`Unexpected export content type "${type}". No file was downloaded.`);
  }

  // Generic or missing content types: look at the start of the body so a JSON
  // or HTML error that was mislabelled is still caught.
  if (type === '' || type === 'application/octet-stream' || type === 'text/plain') {
    const head = (await readText(blob.slice(0, 256))).trimStart();
    if (head.startsWith('{') || head.startsWith('[')) {
      const reason = messageFromJson(await readText(blob));
      if (reason !== undefined || head.startsWith('{')) {
        throw new InvalidExportError(
          reason
            ? `The server returned an error instead of a file: ${reason}`
            : 'The server returned an error instead of a file.',
        );
      }
    }
    if (/^<(!doctype|html)/i.test(head)) {
      throw new InvalidExportError('The server returned a web page instead of a CSV file.');
    }
  }
}
