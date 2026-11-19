import {
  Controller,
  Get,
  Delete,
  Param,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorService } from './services/two-factor.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LogoutDto } from './dto/logout.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { TwoFactorEnableDto } from './dto/two-factor-enable.dto';
import { TwoFactorVerifyDto } from './dto/two-factor-verify.dto';
import { TwoFactorTokenDto } from './dto/two-factor-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../security/decorators/rate-limit.decorator';
import { SessionsService, SessionMeta } from './services/sessions.service';
import { getClientIp } from '../../common/utils/client-ip.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const REFRESH_COOKIE = 'refreshToken';

/** Client details recorded on a session, shown on the account security page. */
const sessionMeta = (req: Request): SessionMeta => ({
  ipAddress: getClientIp(req),
  userAgent: req.headers['user-agent'] ?? null,
});
const refreshCookieOptions = (isProduction: boolean) => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
});

@Controller('auth')
export class AuthController {
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(
    private authService: AuthService,
    private twoFactorService: TwoFactorService,
    private sessionsService: SessionsService,
  ) {}

  @Post('login')
  @RateLimit({ limit: 5, windowMs: 60_000, keyBy: 'ip' })
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    Omit<AuthResponseDto, 'refreshToken'> & {
      requires2FA?: boolean;
      preAuthToken?: string;
    }
  > {
    const result = await this.authService.login(loginDto);
    if (!result.requires2FA && result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE,
        result.refreshToken,
        refreshCookieOptions(this.isProduction),
      );
      if (result.user?.id) {
        await this.sessionsService.createSession(
          result.user.id,
          result.refreshToken,
          sessionMeta(req),
        );
      }
    }
    const { refreshToken: _, ...response } = result;
    return response;
  }

  @Post('register')
  @RateLimit({ limit: 5, windowMs: 60_000, keyBy: 'ip' })
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const result = await this.authService.register(registerDto);
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE,
        result.refreshToken,
        refreshCookieOptions(this.isProduction),
      );
      if (result.user?.id) {
        await this.sessionsService.createSession(
          result.user.id,
          result.refreshToken,
          sessionMeta(req),
        );
      }
    }
    const { refreshToken: _, ...response } = result;
    return response;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req,
    @Body() logoutDto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    const refreshToken: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await this.sessionsService.revokeByRefreshToken(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    // Revoke the bearer token used for this request, not only one in the body.
    const bearer = req.headers?.authorization?.split(' ')[1];
    return this.authService.logout(req.user, {
      ...logoutDto,
      accessToken: logoutDto?.accessToken ?? bearer,
    });
  }

  @Post('refresh')
  @RateLimit({ limit: 10, windowMs: 60_000, keyBy: 'ip' })
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const refreshToken: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }
    // A session revoked from the account security page must not be revived.
    const session = await this.sessionsService.findByRefreshToken(refreshToken);
    if (session?.revokedAt) {
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
      throw new UnauthorizedException('Session has been revoked');
    }
    const result = await this.authService.refreshTokens(refreshToken);
    if (result.user?.id && result.refreshToken) {
      await this.sessionsService.rotate(
        result.user.id,
        refreshToken,
        result.refreshToken,
        sessionMeta(req),
      );
    }
    res.cookie(
      REFRESH_COOKIE,
      result.refreshToken,
      refreshCookieOptions(this.isProduction),
    );
    const { refreshToken: _, ...response } = result;
    return response;
  }

  // ──────────────────────────── 2FA endpoints ────────────────────────────

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setup2fa(@Req() req) {
    return this.twoFactorService.generateSetup(req.user);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async enable2fa(
    @Req() req,
    @Body() dto: TwoFactorEnableDto,
  ): Promise<{ backupCodes: string[] }> {
    return this.twoFactorService.enable(req.user.id, dto.secret, dto.token);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disable2fa(@Req() req, @Body() dto: TwoFactorTokenDto): Promise<void> {
    return this.twoFactorService.disable(req.user.id, dto.token);
  }

  @Post('2fa/verify')
  @RateLimit({ limit: 5, windowMs: 60_000, keyBy: 'ip' })
  @Public()
  @HttpCode(HttpStatus.OK)
  async verify2fa(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const result = await this.authService.verifyTwoFactor(
      dto.preAuthToken,
      dto.token,
    );
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE,
        result.refreshToken,
        refreshCookieOptions(this.isProduction),
      );
      if (result.user?.id) {
        await this.sessionsService.createSession(
          result.user.id,
          result.refreshToken,
          sessionMeta(req),
        );
      }
    }
    const { refreshToken: _, ...response } = result;
    return response;
  }

  @Post('2fa/backup-codes/regenerate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async regenerateBackupCodes(
    @Req() req,
    @Body() dto: TwoFactorTokenDto,
  ): Promise<{ backupCodes: string[] }> {
    return this.twoFactorService.regenerateBackupCodes(req.user.id, dto.token);
  }

  /** #1184 — list active sessions for the current user */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async listSessions(@CurrentUser('id') userId: string, @Req() req: Request) {
    const currentRefresh = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.sessionsService.listForUser(userId, currentRefresh);
  }

  /** #1184 — revoke a single session */
  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('id') sessionId: string,
  ) {
    await this.sessionsService.revokeSession(userId, sessionId);
  }

  /** #1184 — sign out everywhere (all sessions + bump tokenVersion) */
  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(@CurrentUser('id') userId: string) {
    const count = await this.sessionsService.revokeAll(userId);
    return { revoked: count };
  }
}
