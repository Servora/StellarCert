import { OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtManagementService } from '../auth/services/jwt.service';
import { UsersService } from '../users/users.service';
import { UserStatus } from '../users/entities/user.entity';
import { Notification } from './entities/notification.entity';
import { LoggingService } from '../../common/logging/logging.service';

const DEFAULT_REVALIDATE_INTERVAL_MS = 60_000;

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      // Get ALLOWED_ORIGINS from config service or environment
      const allowedOriginsEnv =
        process.env.ALLOWED_ORIGINS || 'http://localhost:5173';
      const allowedOrigins = allowedOriginsEnv.split(',').map((o) => o.trim());

      // Allow non-browser requests (like mobile apps, curl, Postman) if origin is undefined/null
      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  /** Per-socket timers that re-check the connection's access token and user. */
  private readonly revalidationTimers = new Map<string, NodeJS.Timeout>();
  /** Sockets whose re-check is running, so a slow check is never overlapped. */
  private readonly revalidating = new Set<string>();

  constructor(
    private readonly jwtManagementService: JwtManagementService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Validate CORS origin against ALLOWED_ORIGINS at connection handshake if origin header is present
      const origin = client.handshake.headers.origin;
      if (origin) {
        const allowedOriginsEnv =
          this.configService.get<string>('ALLOWED_ORIGINS') ||
          process.env.ALLOWED_ORIGINS ||
          'http://localhost:5173';
        const allowedOrigins = allowedOriginsEnv
          .split(',')
          .map((o) => o.trim());
        if (!allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
          this.logger.warn(
            `Rejected WebSocket connection from disallowed origin: ${origin}`,
          );
          client.disconnect();
          return;
        }
      }

      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }

      // Verify access token with revocation/blacklist check
      const payload = await this.jwtManagementService.verifyAccessToken(token);
      const userId = payload.sub || payload.id;

      // Validate user active status / suspension / existence
      const user = await this.usersService.findOneById(userId);
      if (
        !user ||
        user.status === UserStatus.SUSPENDED ||
        user.status === UserStatus.INACTIVE
      ) {
        this.logger.warn(
          `Rejected WebSocket connection for inactive/suspended user: ${userId}`,
        );
        client.disconnect();
        return;
      }

      await client.join(`user_${userId}`);
      // Remembered so the session can be re-validated while the socket stays open.
      client.data = { ...client.data, token, userId };
      this.startRevalidation(client);
      this.logger.log(`Client connected and joined room user_${userId}`);
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.stopRevalidation(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  onModuleDestroy() {
    for (const timer of this.revalidationTimers.values()) clearInterval(timer);
    this.revalidationTimers.clear();
  }

  /** How often open sockets are re-validated (`WS_AUTH_REVALIDATE_INTERVAL_MS`, default 60s). */
  private revalidateIntervalMs(): number {
    const configured = Number(
      this.configService.get('WS_AUTH_REVALIDATE_INTERVAL_MS'),
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_REVALIDATE_INTERVAL_MS;
  }

  private startRevalidation(client: Socket) {
    this.stopRevalidation(client.id);
    const timer = setInterval(() => {
      void this.revalidate(client);
    }, this.revalidateIntervalMs());
    timer.unref?.();
    this.revalidationTimers.set(client.id, timer);
  }

  private stopRevalidation(clientId: string) {
    const timer = this.revalidationTimers.get(clientId);
    if (timer) clearInterval(timer);
    this.revalidationTimers.delete(clientId);
    this.revalidating.delete(clientId);
  }

  /**
   * Re-checks an open socket: the access token must still verify (it is not
   * blacklisted by logout and has not expired) and the user must still be
   * active. A socket that fails is told its session ended and is disconnected,
   * so session revocation and suspension reach realtime connections. A failure
   * to look the user up (for example a database outage) keeps the socket and is
   * retried on the next check. Returns whether the socket is still allowed.
   */
  async revalidate(client: Socket): Promise<boolean> {
    if (this.revalidating.has(client.id)) return true;
    this.revalidating.add(client.id);
    try {
      const { token, userId } = (client.data ?? {}) as {
        token?: string;
        userId?: string;
      };
      if (!token || !userId) return this.revoke(client, 'missing credentials');

      try {
        await this.jwtManagementService.verifyAccessToken(token);
      } catch (error) {
        return this.revoke(
          client,
          `access token is no longer valid (${error instanceof Error ? error.message : String(error)})`,
        );
      }

      let user: Awaited<ReturnType<UsersService['findOneById']>>;
      try {
        user = await this.usersService.findOneById(userId);
      } catch (error) {
        this.logger.warn(
          `Could not re-check user ${userId} for socket ${client.id}; keeping it until the next check: ${error instanceof Error ? error.message : String(error)}`,
        );
        return true;
      }
      if (
        !user ||
        user.status === UserStatus.SUSPENDED ||
        user.status === UserStatus.INACTIVE
      ) {
        return this.revoke(client, 'user is suspended, inactive or removed');
      }
      return true;
    } finally {
      this.revalidating.delete(client.id);
    }
  }

  private revoke(client: Socket, reason: string): false {
    this.logger.warn(
      `Disconnecting WebSocket ${client.id} after re-validation: ${reason}`,
    );
    this.stopRevalidation(client.id);
    client.emit('sessionRevoked', { reason: 'session_revoked' });
    client.disconnect(true);
    return false;
  }

  sendNotification(userId: string, notification: Notification) {
    this.server.to(`user_${userId}`).emit('newNotification', notification);
  }
}
