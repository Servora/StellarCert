import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from '../auth.service';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { Public } from '../../../common/decorators/public.decorator';

const REFRESH_COOKIE = 'refreshToken';
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

@ApiTags('Authentication v2')
@Controller({ path: 'auth', version: '2' })
export class AuthV2Controller {
  constructor(private authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user (v2) - Enhanced with metadata' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthResponseDto })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const result = await this.authService.login(loginDto);
    if (!('requires2FA' in result) && result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    }
    const { refreshToken: _, ...response } = result;
    return {
      ...response,
      metadata: {
        version: '2',
        timestamp: new Date().toISOString(),
        expiresIn: 3600,
      },
    };
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new user (v2) - Enhanced with metadata' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AuthResponseDto })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AuthResponseDto, 'refreshToken'>> {
    const result = await this.authService.register(registerDto);
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    }
    const { refreshToken: _, ...response } = result;
    return {
      ...response,
      metadata: {
        version: '2',
        timestamp: new Date().toISOString(),
        expiresIn: 3600,
      },
    };
  }
}
