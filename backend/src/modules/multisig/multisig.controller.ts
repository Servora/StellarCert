import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MultisigService, RequestStatus, Pagination } from './multisig.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../../common/constants/roles';
import { LoggingService } from '../../common/logging/logging.service';

class InitMultisigConfigDto {
  issuer: string;
  threshold: number;
  signers: string[];
  maxSigners: number;

  constructor(private readonly logger: LoggingService) {}
}

class UpdateMultisigConfigDto {
  threshold?: number;
  signers?: string[];
  maxSigners?: number;

  constructor(private readonly logger: LoggingService) {}
}

class ProposeCertificateDto {
  requestId: string;
  issuer: string;
  recipient: string;
  metadata: string;
  expirationDays: number;

  constructor(private readonly logger: LoggingService) {}
}

class ApproveRequestDto {
  requestId: string;

  constructor(private readonly logger: LoggingService) {}
}

class RejectRequestDto {
  requestId: string;
  reason?: string;

  constructor(private readonly logger: LoggingService) {}
}

class IssueCertificateDto {
  requestId: string;

  constructor(private readonly logger: LoggingService) {}
}

class CancelRequestDto {
  requestId: string;

  constructor(private readonly logger: LoggingService) {}
}

@Controller('multisig')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MultisigController {
  constructor(
    private readonly multisigService: MultisigService,
    private readonly logger: LoggingService,
  ) {}

  @Post('config/init')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async initMultisigConfig(
    @CurrentUser() user: User,
    @Body() configDto: InitMultisigConfigDto,
  ): Promise<{ transactionHash: string }> {
    try {
      const transactionHash = await this.multisigService.initMultisigConfig(
        user.stellarPublicKey,
        configDto.issuer,
        configDto.threshold,
        configDto.signers,
        configDto.maxSigners,
      );
      return { transactionHash };
    } catch (error) {
      this.logger.error('Failed to initialize multisig config', error);
      throw new HttpException(
        'Failed to initialize multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('config/update/:issuer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async updateMultisigConfig(
    @CurrentUser() user: User,
    @Param('issuer') issuer: string,
    @Body() configDto: UpdateMultisigConfigDto,
  ): Promise<{ transactionHash: string }> {
    try {
      const transactionHash = await this.multisigService.updateMultisigConfig(
        user.stellarPublicKey,
        issuer,
        configDto.threshold,
        configDto.signers,
        configDto.maxSigners,
      );
      return { transactionHash };
    } catch (error) {
      this.logger.error(
        `Failed to update multisig config for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to update multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('propose')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async proposeCertificate(
    @CurrentUser() user: User,
    @Body() proposeDto: ProposeCertificateDto,
  ): Promise<any> {
    try {
      const result = await this.multisigService.proposeCertificate(
        user.stellarPublicKey,
        proposeDto.requestId,
        proposeDto.issuer,
        proposeDto.recipient,
        proposeDto.metadata,
        proposeDto.expirationDays,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to propose certificate ${proposeDto.requestId}`,
        error,
      );
      throw new HttpException(
        'Failed to propose certificate',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('approve/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async approveRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<any> {
    try {
      const result = await this.multisigService.approveRequest(
        user.stellarPublicKey,
        requestId,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to approve request ${requestId}`, error);
      throw new HttpException(
        'Failed to approve request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('reject/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async rejectRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
    @Body() rejectDto: RejectRequestDto,
  ): Promise<any> {
    try {
      const result = await this.multisigService.rejectRequest(
        user.stellarPublicKey,
        requestId,
        rejectDto.reason,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to reject request ${requestId}`, error);
      throw new HttpException(
        'Failed to reject request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('issue/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async issueApprovedCertificate(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<{ success: boolean }> {
    try {
      const success = await this.multisigService.issueApprovedCertificate(
        user.stellarPublicKey,
        requestId,
      );
      return { success };
    } catch (error) {
      this.logger.error(
        `Failed to issue certificate for request ${requestId}`,
        error,
      );
      throw new HttpException(
        'Failed to issue certificate',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('cancel/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async cancelRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<{ success: boolean }> {
    try {
      const success = await this.multisigService.cancelRequest(
        user.stellarPublicKey,
        requestId,
      );
      return { success };
    } catch (error) {
      this.logger.error(`Failed to cancel request ${requestId}`, error);
      throw new HttpException(
        'Failed to cancel request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('config/:issuer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async getMultisigConfig(@Param('issuer') issuer: string): Promise<any> {
    try {
      const config = await this.multisigService.getMultisigConfig(issuer);
      return config;
    } catch (error) {
      this.logger.error(
        `Failed to get multisig config for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to get multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('request/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async getPendingRequest(@Param('requestId') requestId: string): Promise<any> {
    try {
      const request = await this.multisigService.getPendingRequest(requestId);
      return request;
    } catch (error) {
      this.logger.error(`Failed to get pending request ${requestId}`, error);
      throw new HttpException(
        'Failed to get pending request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('requests/issuer/:issuer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async getPendingRequestsForIssuer(
    @Param('issuer') issuer: string,
    @Query('page') page: number = 0,
    @Query('limit') limit: number = 20,
  ): Promise<any> {
    try {
      const pagination: Pagination = {
        page: Number(page),
        limit: Number(limit),
      };
      const result = await this.multisigService.getPendingRequestsForIssuer(
        issuer,
        pagination,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get pending requests for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to get pending requests for issuer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('requests/signer/:signer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async getPendingRequestsForSigner(
    @Param('signer') signer: string,
    @Query('page') page: number = 0,
    @Query('limit') limit: number = 20,
  ): Promise<any> {
    try {
      const pagination: Pagination = {
        page: Number(page),
        limit: Number(limit),
      };
      const result = await this.multisigService.getPendingRequestsForSigner(
        signer,
        pagination,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get pending requests for signer ${signer}`,
        error,
      );
      throw new HttpException(
        'Failed to get pending requests for signer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('expired/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async isRequestExpired(
    @Param('requestId') requestId: string,
  ): Promise<{ expired: boolean }> {
    try {
      const expired = await this.multisigService.isRequestExpired(requestId);
      return { expired };
    } catch (error) {
      this.logger.error(
        `Failed to check if request ${requestId} is expired`,
        error,
      );
      throw new HttpException(
        'Failed to check request expiration status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  async getRequestStatus(
    @Param('requestId') requestId: string,
  ): Promise<{ status: number }> {
    try {
      const request = await this.multisigService.getPendingRequest(requestId);
      return { status: request.status };
    } catch (error) {
      this.logger.error(`Failed to get request status for ${requestId}`, error);
      throw new HttpException(
        'Failed to get request status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
