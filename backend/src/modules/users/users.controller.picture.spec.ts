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
  };
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
