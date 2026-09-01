/**
 * Validates that a file buffer's magic bytes match the declared MIME type.
 * Acts as a lightweight defence-in-depth layer before storage; a full
 * ClamAV integration (e.g. via `clamscan` or `node-clam`) should be added
 * for production virus scanning.
 */

/** Known magic-byte signatures mapped to their MIME types. */
const MAGIC_BYTES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

/**
 * Returns true when the buffer's leading bytes match the expected signature
 * for the given MIME type.
 */
export function fileHeaderMatchesMime(
  buffer: Buffer,
  declaredMime: string,
): boolean {
  const signature = MAGIC_BYTES.find((s) => s.mime === declaredMime);
  if (!signature) return false;

  const offset = signature.offset ?? 0;
  return signature.bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Throws if the file header does not match the declared MIME type.
 * Use this in any file-upload handler before persisting the file.
 */
export function assertSafeFileHeader(
  buffer: Buffer,
  declaredMime: string,
): void {
  if (!fileHeaderMatchesMime(buffer, declaredMime)) {
    throw new Error(
      `File header does not match declared MIME type "${declaredMime}". Upload rejected.`,
    );
  }
}

/** Allowed MIME types for uploads in this application. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}
