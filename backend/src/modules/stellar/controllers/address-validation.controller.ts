import { Controller, Get, Post, Body, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AddressValidationService } from '../services/address-validation.service';
import {
  AddressValidationRequest,
  BulkAddressValidationRequest,
  AddressValidationResult,
  BulkAddressValidationResult,
} from '../dto/address-validation.dto';
import { StellarNetwork } from '../dto/address-validation.dto';

@ApiTags('stellar-address-validation')
@Controller('stellar/address-validation')
export class AddressValidationController {
  constructor(private readonly addressValidationService: AddressValidationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a single Stellar address' })
  @ApiResponse({
    status: 200,
    description: 'Address validation result',
    type: AddressValidationResult,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
  })
  async validateAddress(@Body() request: AddressValidationRequest): Promise<AddressValidationResult> {
    return this.addressValidationService.validate(request);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate multiple Stellar addresses' })
  @ApiResponse({
    status: 200,
    description: 'Bulk address validation results',
    type: BulkAddressValidationResult,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
  })
  async validateBulk(@Body() request: BulkAddressValidationRequest): Promise<BulkAddressValidationResult> {
    return this.addressValidationService.validateBulk(request);
  }

  @Get('check/:address')
  @ApiOperation({ summary: 'Validate and check existence of a Stellar address' })
  @ApiParam({ name: 'address', description: 'Stellar address to validate' })
  @ApiResponse({
    status: 200,
    description: 'Address validation and existence check result',
    type: AddressValidationResult,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid address format',
  })
  async validateAndCheckExists(
    @Body('network') network?: StellarNetwork,
  ): Promise<AddressValidationResult> {
    // Note: In a real implementation, you'd extract the address from the URL params
    // This is a simplified version for demonstration
    throw new Error('Use POST endpoint for address validation');
  }

  @Post('check/:address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and check existence of a Stellar address' })
  @ApiParam({ name: 'address', description: 'Stellar address to validate' })
  @ApiResponse({
    status: 200,
    description: 'Address validation and existence check result',
    type: AddressValidationResult,
  })
  async validateAndCheckExistsWithAddress(
    @Body('address') address: string,
    @Body('network') network?: StellarNetwork,
  ): Promise<AddressValidationResult> {
    return this.addressValidationService.validateAndCheckExists(address, network);
  }

  @Delete('cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the address validation cache' })
  @ApiResponse({
    status: 200,
    description: 'Cache cleared successfully',
  })
  async clearCache(): Promise<{ message: string }> {
    await this.addressValidationService.clearCache();
    return { message: 'Address validation cache cleared successfully' };
  }

  @Get('cache/stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  @ApiResponse({
    status: 200,
    description: 'Cache statistics',
    schema: {
      type: 'object',
      properties: {
        size: { type: 'number' },
        ttl: { type: 'number' },
        maxSize: { type: 'number' },
      },
    },
  })
  async getCacheStats(): Promise<{ size: number; ttl: number; maxSize: number }> {
    return this.addressValidationService.getCacheStats();
  }
}
