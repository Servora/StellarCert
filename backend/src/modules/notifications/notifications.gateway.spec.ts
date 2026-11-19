import { NotificationsGateway } from './notifications.gateway';
import { UserStatus } from '../users/entities/user.entity';

const INTERVAL = 30_000;

function makeSocket(id = 'socket-1') {
  return {
    id,
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: 'access-token' }, headers: {} as Record<string, string> },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('NotificationsGateway session re-validation', () => {
  let gateway: NotificationsGateway;
  const jwt = { verifyAccessToken: jest.fn() };
  const users = { findOneById: jest.fn() };
  const config = { get: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jwt.verifyAccessToken.mockResolvedValue({ sub: 'user-1' });
    users.findOneById.mockResolvedValue({ id: 'user-1', status: UserStatus.ACTIVE });
    config.get.mockImplementation((key: string) =>
      key === 'WS_AUTH_REVALIDATE_INTERVAL_MS' ? String(INTERVAL) : undefined,
    );
    gateway = new NotificationsGateway(jwt as never, users as never, config as never, logger as never);
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  async function connect(socket = makeSocket()) {
    await gateway.handleConnection(socket as never);
    jwt.verifyAccessToken.mockClear();
    users.findOneById.mockClear();
    return socket;
  }

  it('keeps a valid connection and re-checks it on every interval', async () => {
    const socket = await connect();
    expect(socket.join).toHaveBeenCalledWith('user_user-1');

    await jest.advanceTimersByTimeAsync(INTERVAL);
    await jest.advanceTimersByTimeAsync(INTERVAL);

    expect(jwt.verifyAccessToken).toHaveBeenCalledTimes(2);
    expect(jwt.verifyAccessToken).toHaveBeenCalledWith('access-token');
    expect(users.findOneById).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a socket whose token was revoked (logout) after the handshake', async () => {
    const socket = await connect();
    jwt.verifyAccessToken.mockRejectedValue(new Error('Invalid access token: Token has been revoked'));

    await jest.advanceTimersByTimeAsync(INTERVAL);

    expect(socket.emit).toHaveBeenCalledWith('sessionRevoked', { reason: 'session_revoked' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects a socket whose user was suspended, deactivated or removed', async () => {
    const lookups = [
      { id: 'user-1', status: UserStatus.SUSPENDED },
      { id: 'user-1', status: UserStatus.INACTIVE },
      undefined,
    ];
    for (const [index, lookup] of lookups.entries()) {
      // Active at the handshake, changed afterwards.
      const socket = await connect(makeSocket(`socket-${index}`));
      users.findOneById.mockResolvedValue(lookup);

      await jest.advanceTimersByTimeAsync(INTERVAL);

      expect(socket.emit).toHaveBeenCalledWith('sessionRevoked', { reason: 'session_revoked' });
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      users.findOneById.mockResolvedValue({ id: 'user-1', status: UserStatus.ACTIVE });
    }
  });

  it('stops checking a socket once it has been disconnected', async () => {
    const socket = await connect();
    jwt.verifyAccessToken.mockRejectedValue(new Error('revoked'));
    await jest.advanceTimersByTimeAsync(INTERVAL);
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(jwt.verifyAccessToken).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clears the timer when the client disconnects on its own', async () => {
    const socket = await connect();

    gateway.handleDisconnect(socket as never);
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(jwt.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('keeps the socket when the user lookup fails temporarily and retries later', async () => {
    const socket = await connect();
    users.findOneById.mockRejectedValueOnce(new Error('db down'));

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('db down'));

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(users.findOneById).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('uses a one-minute default interval and ignores an invalid configured one', async () => {
    config.get.mockReturnValue('not-a-number');
    gateway = new NotificationsGateway(jwt as never, users as never, config as never, logger as never);
    await connect();

    await jest.advanceTimersByTimeAsync(59_000);
    expect(jwt.verifyAccessToken).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(jwt.verifyAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not start checking a connection that failed the handshake', async () => {
    const socket = makeSocket();
    jwt.verifyAccessToken.mockRejectedValue(new Error('bad token'));

    await gateway.handleConnection(socket as never);
    expect(socket.disconnect).toHaveBeenCalled();

    jwt.verifyAccessToken.mockClear();
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(jwt.verifyAccessToken).not.toHaveBeenCalled();
  });
});
