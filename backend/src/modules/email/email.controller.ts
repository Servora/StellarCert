import {
  Controller,
  Post,
  Body,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RateLimit } from '../security/decorators/rate-limit.decorator';
import { Roles } from '../users/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { SendCertificateIssuedDto } from './dto/send-certificate-issued.dto';
import { SendVerificationDto } from './dto/send-verification.dto';
import { SendPasswordResetDto } from './dto/send-password-reset.dto';
import { SendRevocationNoticeDto } from './dto/send-revocation-notice.dto';
import { LoggingService } from '../../common/logging/logging.service';

@ApiTags('Email')
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@RateLimit({ limit: 5, windowMs: 60_000, keyBy: 'user' })
export class EmailController {
  constructor(
    private emailService: EmailService,
    private emailQueueService: EmailQueueService,
    private readonly logger: LoggingService,
  ) {}

  @Post('send-certificate-issued')
  @ApiOperation({ summary: 'Send certificate issued notification email' })
  @ApiResponse({ status: 200, description: 'Email queued successfully' })
  @ApiResponse({ status: 503, description: 'Email queue unavailable' })
  async sendCertificateIssued(
    @Body() dto: SendCertificateIssuedDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.emailQueueService.queueCertificateIssued(dto);
      return {
        success: true,
        message: 'Certificate issued email queued successfully',
      };
    } catch {
      this.logger.error('Error queuing certificate issued email');
      throw new ServiceUnavailableException(
        'Failed to queue certificate issued email',
      );
    }
  }

  @Post('send-verification')
  @ApiOperation({ summary: 'Send email verification email' })
  @ApiResponse({
    status: 200,
    description: 'Verification email queued successfully',
  })
  @ApiResponse({ status: 503, description: 'Email queue unavailable' })
  async sendVerificationEmail(
    @Body() dto: SendVerificationDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.emailQueueService.queueVerificationEmail(dto);
      return {
        success: true,
        message: 'Verification email queued successfully',
      };
    } catch {
      this.logger.error('Error queuing verification email');
      throw new ServiceUnavailableException(
        'Failed to queue verification email',
      );
    }
  }

  @Post('send-password-reset')
  @ApiOperation({ summary: 'Send password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset email queued successfully',
  })
  @ApiResponse({ status: 503, description: 'Email queue unavailable' })
  async sendPasswordReset(
    @Body() dto: SendPasswordResetDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.emailQueueService.queuePasswordReset(dto);
      return {
        success: true,
        message: 'Password reset email queued successfully',
      };
    } catch {
      this.logger.error('Error queuing password reset email');
      throw new ServiceUnavailableException(
        'Failed to queue password reset email',
      );
    }
  }

  @Post('send-revocation-notice')
  @ApiOperation({ summary: 'Send certificate revocation notice email' })
  @ApiResponse({
    status: 200,
    description: 'Revocation notice email queued successfully',
  })
  @ApiResponse({ status: 503, description: 'Email queue unavailable' })
  async sendRevocationNotice(
    @Body() dto: SendRevocationNoticeDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.emailQueueService.queueRevocationNotice(dto);
      return {
        success: true,
        message: 'Revocation notice email queued successfully',
      };
    } catch {
      this.logger.error('Error queuing revocation notice email');
      throw new ServiceUnavailableException(
        'Failed to queue revocation notice email',
      );
    }
  }
}
