import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SorobanService } from '../services/soroban.service';
import { JwtAuthGuard } from 'src/common';
import { RolesGuard } from '../../users/guards/roles.guard';
import { Roles } from '../../users/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { LoggingService } from '../../../common/logging/logging.service';

@ApiTags('Soroban')
@Controller('soroban')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SorobanController {
  constructor(
    private readonly sorobanService: SorobanService,
    private readonly logger: LoggingService,
  ) {}

  @Post('initialize-contract')
  @ApiOperation({ summary: 'Initialize the certificate contract' })
  @ApiResponse({
    status: 200,
    description: 'Contract initialized successfully',
  })
  @ApiResponse({ status: 500, description: 'Failed to initialize contract' })
  async initializeContract(@Body() body: { adminAddress: string }) {
    try {
      const success = await this.sorobanService.initializeCertificateContract(
        body.adminAddress,
      );

      if (success) {
        return {
          success: true,
          message: 'Certificate contract initialized successfully',
        };
      } else {
        return {
          success: false,
          message: 'Failed to initialize certificate contract',
        };
      }
    } catch (error) {
      this.logger.error(`Contract initialization error: ${error.message}`);
      return {
        success: false,
        message: `Contract initialization failed: ${error.message}`,
      };
    }
  }

  @Post('add-issuer')
  @ApiOperation({ summary: 'Add an authorized issuer to the contract' })
  @ApiResponse({ status: 200, description: 'Issuer added successfully' })
  async addIssuer(@Body() body: { issuerAddress: string }) {
    try {
      const success = await this.sorobanService.addIssuer(body.issuerAddress);

      if (success) {
        return {
          success: true,
          message: 'Issuer added to contract successfully',
        };
      } else {
        return {
          success: false,
          message: 'Failed to add issuer to contract',
        };
      }
    } catch (error) {
      this.logger.error(`Add issuer error: ${error.message}`);
      return {
        success: false,
        message: `Add issuer failed: ${error.message}`,
      };
    }
  }

  @Post('init-multisig')
  @ApiOperation({ summary: 'Initialize multisig configuration for an issuer' })
  @ApiResponse({
    status: 200,
    description: 'Multisig initialized successfully',
  })
  async initMultisig(
    @Body()
    body: {
      issuerAddress: string;
      threshold: number;
      signers: string[];
      maxSigners: number;
    },
  ) {
    try {
      const success = await this.sorobanService.initMultisigConfig(
        body.issuerAddress,
        body.threshold,
        body.signers,
        body.maxSigners,
      );

      if (success) {
        return {
          success: true,
          message: 'Multisig configuration initialized successfully',
        };
      } else {
        return {
          success: false,
          message: 'Failed to initialize multisig configuration',
        };
      }
    } catch (error) {
      this.logger.error(`Multisig initialization error: ${error.message}`);
      return {
        success: false,
        message: `Multisig initialization failed: ${error.message}`,
      };
    }
  }

  @Get('certificate/:id')
  @ApiOperation({ summary: 'Get certificate data from the contract' })
  @ApiResponse({ status: 200, description: 'Certificate data retrieved' })
  async getCertificate(@Param('id') id: string) {
    try {
      const certificate = await this.sorobanService.getCertificate(id);

      if (certificate) {
        return {
          success: true,
          data: certificate,
        };
      } else {
        return {
          success: false,
          message: 'Certificate not found on-chain',
        };
      }
    } catch (error) {
      this.logger.error(`Get certificate error: ${error.message}`);
      return {
        success: false,
        message: `Get certificate failed: ${error.message}`,
      };
    }
  }

  @Get('status')
  @ApiOperation({ summary: 'Check Soroban service status' })
  @ApiResponse({ status: 200, description: 'Service status' })
  getStatus() {
    return {
      configured: this.sorobanService.isConfigured(),
      message: this.sorobanService.isConfigured()
        ? 'Soroban service is properly configured'
        : 'Soroban service is not configured',
    };
  }
}
