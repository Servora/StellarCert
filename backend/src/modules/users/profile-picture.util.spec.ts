import {
  extensionForMimeType,
  profilePictureKey,
  storageKeyFor,
} from './profile-picture.util';

describe('profile-picture.util', () => {
  it('derives the extension from the validated MIME type', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('jpg');
    expect(extensionForMimeType('IMAGE/PNG')).toBe('png');
    expect(extensionForMimeType('text/html')).toBeUndefined();
  });

  it('builds a key that ignores whatever file name the client sent', () => {
    expect(profilePictureKey('u1', 'image/webp', 42)).toBe(
      'profile-pictures/u1-42.webp',
    );
    expect(() => profilePictureKey('u1', 'application/x-sh', 1)).toThrow();
  });

  it('keeps stored keys as they are', () => {
    expect(storageKeyFor('profile-pictures/u1-42.png')).toBe(
      'profile-pictures/u1-42.png',
    );
    expect(storageKeyFor(null)).toBeNull();
    expect(storageKeyFor('')).toBeNull();
  });

  it('recovers the key from a legacy expired signed URL', () => {
    const legacy =
      'https://s3.example.com/bucket/profile-pictures/u1-42.jpg?X-Amz-Expires=3600&X-Amz-Signature=abc';
    expect(storageKeyFor(legacy)).toBe('profile-pictures/u1-42.jpg');
  });

  it('returns null for a URL that does not point at a profile picture', () => {
    expect(storageKeyFor('https://evil.example.com/x.png')).toBeNull();
  });
});
