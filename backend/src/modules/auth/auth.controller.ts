import {
  Controller,
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

const REFRESH_COOKIE = 'refreshToken';
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
  ) {}

  @Post('login')
  @RateLimit({ limit: 5, windowMs: 60_000, keyBy: 'ip' })
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const result = await this.authService.register(registerDto);
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE,
        result.refreshToken,
        refreshCookieOptions(this.isProduction),
      );
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
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return this.authService.logout(req.user, logoutDto);
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
    const result = await this.authService.refreshTokens(refreshToken);
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
  @Public()
  @HttpCode(HttpStatus.OK)
  async verify2fa(
    @Body() dto: TwoFactorVerifyDto,
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
}
