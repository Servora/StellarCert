/**
 * Profile pictures are stored by object key, never by pre-signed URL: a signed
 * URL expires (and bakes in credentials), while the key stays valid. A fresh
 * URL is signed whenever a profile is read.
 */
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const PROFILE_PICTURE_PREFIX = 'profile-pictures/';

/** The file extension for a validated image MIME type, or undefined if it is not one we accept. */
export function extensionForMimeType(mimeType: string): string | undefined {
  return EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()];
}

/** Object key for a new upload. The extension comes from the MIME type, never from the client's file name. */
export function profilePictureKey(
  userId: string,
  mimeType: string,
  now: number = Date.now(),
): string {
  const extension = extensionForMimeType(mimeType);
  if (!extension) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }
  return `${PROFILE_PICTURE_PREFIX}${userId}-${now}.${extension}`;
}

/**
 * The storage key behind a stored `profilePicture` value. Rows written before
 * keys were stored hold a full (by now expired) signed URL; the key is recovered
 * from its path so those users get a working picture again.
 */
export function storageKeyFor(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const { pathname } = new URL(value);
    const index = pathname.indexOf(PROFILE_PICTURE_PREFIX);
    return index >= 0 ? decodeURIComponent(pathname.slice(index)) : null;
  } catch {
    return null;
  }
}
