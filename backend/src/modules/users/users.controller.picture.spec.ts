import { UsersController } from './users.controller';

describe('UsersController profile pictures', () => {
  const user = { id: 'u1', profilePicture: 'profile-pictures/u1-1.png' };
  const usersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };
  const storageService = {
    uploadFile: jest.fn(),
    getSignedUrl: jest.fn(),
    deleteFile: jest.fn(),
  };
  let controller: UsersController;

  const png = (originalname = 'a.png') => ({
    buffer: Buffer.from('x'),
    size: 1,
    mimetype: 'image/png',
    originalname,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    storageService.uploadFile.mockImplementation((_b, _n, _m, key: string) =>
      Promise.resolve({ key, url: `https://signed.example/${key}?sig=1` }),
    );
    storageService.deleteFile.mockResolvedValue(undefined);
    usersService.updateProfile.mockResolvedValue({});
    controller = new UsersController(
      usersService as never,
      storageService as never,
    );
  });

  it('signs a fresh URL from the stored key whenever the profile is read', async () => {
    usersService.getProfile.mockResolvedValue({ ...user });
    storageService.getSignedUrl.mockResolvedValue(
      'https://signed.example/pic?sig=new',
    );

    const profile = await controller.getProfile('u1');

    expect(storageService.getSignedUrl).toHaveBeenCalledWith(
      'profile-pictures/u1-1.png',
    );
    expect(profile.profilePicture).toBe('https://signed.example/pic?sig=new');
  });

  it('stores the object key, not the signed URL, after an upload', async () => {
    storageService.uploadFile.mockImplementation((_b, _n, _m, key: string) =>
      Promise.resolve({
        key,
        url: `https://signed.example/${key}?sig=1`,
      }),
    );
    usersService.updateProfile.mockResolvedValue({});

    const result = await controller.uploadProfilePicture('u1', {
      buffer: Buffer.from('x'),
      size: 1,
      mimetype: 'image/png',
      originalname: 'evil.php.exe',
    });

    const savedKey = usersService.updateProfile.mock.calls[0][1].profilePicture;
    expect(savedKey).toMatch(/^profile-pictures\/u1-\d+\.png$/);
    expect(savedKey).not.toContain('http');
    expect(result.profilePicture).toContain('sig=1');
  });

  it('leaves the profile usable when storage cannot sign a URL', async () => {
    usersService.getProfile.mockResolvedValue({ ...user });
    storageService.getSignedUrl.mockRejectedValue(
      new Error('Storage service is not configured'),
    );

    const profile = await controller.getProfile('u1');

    expect(profile.profilePicture).toBeNull();
  });

  describe('replacing a profile picture', () => {
    it('deletes the previous object after the new picture is saved', async () => {
      usersService.getProfile.mockResolvedValue({ ...user });

      await controller.uploadProfilePicture('u1', png());

      expect(storageService.deleteFile).toHaveBeenCalledTimes(1);
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'profile-pictures/u1-1.png',
      );
      const saveOrder = usersService.updateProfile.mock.invocationCallOrder[0];
      const deleteOrder = storageService.deleteFile.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeGreaterThan(saveOrder);
    });

    it('recovers the key from a legacy signed URL before deleting', async () => {
      usersService.getProfile.mockResolvedValue({
        id: 'u1',
        profilePicture:
          'https://s3.example/bucket/profile-pictures/u1-0.png?X-Amz-Signature=abc',
      });

      await controller.uploadProfilePicture('u1', png());

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'profile-pictures/u1-0.png',
      );
    });

    it('deletes nothing for a first upload', async () => {
      usersService.getProfile.mockResolvedValue({ id: 'u1', profilePicture: null });

      await controller.uploadProfilePicture('u1', png());

      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('never deletes a key outside the profile-picture prefix', async () => {
      usersService.getProfile.mockResolvedValue({
        id: 'u1',
        profilePicture: 'certificates/important.pdf',
      });

      await controller.uploadProfilePicture('u1', png());

      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('still succeeds when deleting the old object fails', async () => {
      usersService.getProfile.mockResolvedValue({ ...user });
      storageService.deleteFile.mockRejectedValue(new Error('boom'));

      const result = await controller.uploadProfilePicture('u1', png());

      expect(result.message).toBe('Profile picture uploaded successfully');
      expect(usersService.updateProfile).toHaveBeenCalledTimes(1);
    });

    it('keeps the old object when the upload itself fails', async () => {
      usersService.getProfile.mockResolvedValue({ ...user });
      storageService.uploadFile.mockRejectedValue(new Error('upload failed'));

      await expect(controller.uploadProfilePicture('u1', png())).rejects.toThrow(
        'upload failed',
      );
      expect(usersService.updateProfile).not.toHaveBeenCalled();
      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('proceeds when the previous picture cannot be looked up', async () => {
      usersService.getProfile.mockRejectedValue(new Error('db down'));

      const result = await controller.uploadProfilePicture('u1', png());

      expect(result.message).toBe('Profile picture uploaded successfully');
      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });
  });
});
