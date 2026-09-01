import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CertificateTransferService } from '../services/certificate-transfer.service';
import {
  InitiateTransferDto,
  ApproveTransferDto,
  RejectTransferDto,
} from '../dto/transfer-certificate.dto';
import { JwtAuthGuard } from 'src/common';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Certificate Transfers')
@ApiBearerAuth()
@Controller('certificates/transfers')
export class CertificateTransferController {
  constructor(private readonly transferService: CertificateTransferService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ISSUER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Initiate a certificate ownership transfer' })
  @ApiResponse({ status: 201, description: 'Transfer initiated successfully' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @ApiResponse({ status: 409, description: 'Transfer conflict' })
  async initiateTransfer(
    @Body() dto: InitiateTransferDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.transferService.initiateTransfer(dto, user, req.ip);
  }

  @Post('approve')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Approve a certificate transfer' })
  @ApiResponse({ status: 200, description: 'Transfer approved successfully' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  async approveTransfer(
    @Body() dto: ApproveTransferDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.transferService.approveTransfer(
      dto.transferId,
      dto.confirmationCode || '',
      user,
      req.ip,
    );
  }

  @Post('reject')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Reject a certificate transfer' })
  @ApiResponse({ status: 200, description: 'Transfer rejected successfully' })
  async rejectTransfer(
    @Body() dto: RejectTransferDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.transferService.rejectTransfer(
      dto.transferId,
      dto.reason || 'No reason provided',
      user,
      req.ip,
    );
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel a pending certificate transfer' })
  @ApiResponse({ status: 200, description: 'Transfer cancelled successfully' })
  async cancelTransfer(
    @Param('id') transferId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.transferService.cancelTransfer(transferId, user, req.ip);
  }

  @Get('certificate/:certificateId/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get transfer history for a certificate' })
  async getTransferHistory(@Param('certificateId') certificateId: string) {
    return this.transferService.getTransferHistory(certificateId);
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get pending transfers for the current user' })
  async getPendingTransfers(@CurrentUser('email') email: string) {
    return this.transferService.getPendingTransfers(email);
  }
}
