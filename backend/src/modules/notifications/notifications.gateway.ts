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

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      // Get ALLOWED_ORIGINS from config service or environment
      const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || 'http://localhost:5173';
      const allowedOrigins = allowedOriginsEnv.split(',').map((o) => o.trim());

      // Allow non-browser requests (like mobile apps, curl, Postman) if origin is undefined/null
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

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
        const allowedOrigins = allowedOriginsEnv.split(',').map((o) => o.trim());
        if (!allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
          this.logger.warn(`Rejected WebSocket connection from disallowed origin: ${origin}`);
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
      if (!user || user.status === UserStatus.SUSPENDED || user.status === UserStatus.INACTIVE) {
        this.logger.warn(`Rejected WebSocket connection for inactive/suspended user: ${userId}`);
        client.disconnect();
        return;
      }

      await client.join(`user_${userId}`);
      this.logger.log(`Client connected and joined room user_${userId}`);
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  sendNotification(userId: string, notification: Notification) {
    this.server.to(`user_${userId}`).emit('newNotification', notification);
  }
}
