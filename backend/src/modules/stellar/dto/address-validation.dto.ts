import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum StellarNetwork {
  PUBLIC = 'public',
  TESTNET = 'testnet',
}

export class AddressValidationRequest {
  @ApiProperty({
    description: 'Stellar address to validate',
    example: 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ',
  })
  @IsString()
  address: string;

  @ApiPropertyOptional({
    description: 'Stellar network to validate against',
    enum: StellarNetwork,
    default: StellarNetwork.PUBLIC,
  })
  @IsOptional()
  @IsEnum(StellarNetwork)
  network?: StellarNetwork;

  @ApiPropertyOptional({
    description: 'Whether to check if account exists on Horizon',
    default: false,
  })
  @IsOptional()
  checkExists?: boolean;
}

export class BulkAddressValidationRequest {
  @ApiProperty({
    description: 'Array of Stellar addresses to validate',
    type: [String],
    example: [
      'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ',
      'GB7TNR5G5Z3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K',
    ],
  })
  @IsArray()
  @IsString({ each: true })
  addresses: string[];

  @ApiPropertyOptional({
    description: 'Stellar network to validate against',
    enum: StellarNetwork,
    default: StellarNetwork.PUBLIC,
  })
  @IsOptional()
  @IsEnum(StellarNetwork)
  network?: StellarNetwork;

  @ApiPropertyOptional({
    description: 'Whether to check if accounts exist on Horizon',
    default: false,
  })
  @IsOptional()
  checkExists?: boolean;
}

export class AddressValidationResult {
  @ApiProperty({
    description: 'Whether the address is valid',
    example: true,
  })
  isValid: boolean;

  @ApiProperty({
    description: 'Validation error message if invalid',
    required: false,
  })
  error?: string;

  @ApiProperty({
    description: 'Whether the address format is correct',
    example: true,
  })
  isFormatValid: boolean;

  @ApiProperty({
    description: 'Whether the checksum is valid',
    example: true,
  })
  isChecksumValid: boolean;

  @ApiProperty({
    description: 'Whether the address matches the specified network',
    example: true,
  })
  isNetworkValid: boolean;

  @ApiPropertyOptional({
    description: 'Whether the account exists on Horizon (if checked)',
    example: true,
  })
  @IsOptional()
  accountExists?: boolean;

  @ApiPropertyOptional({
    description: 'Account details from Horizon (if exists)',
  })
  @IsOptional()
  accountDetails?: {
    id: string;
    sequence: string;
    subentry_count: number;
    thresholds: {
      low_threshold: number;
      med_threshold: number;
      high_threshold: number;
    };
    flags: {
      auth_required: boolean;
      auth_revocable: boolean;
      auth_immutable: boolean;
    };
    balances: Array<{
      asset_type: string;
      balance: string;
    }>;
    signers: Array<{
      key: string;
      weight: number;
    }>;
  };
}

export class BulkAddressValidationResult {
  @ApiProperty({
    description: 'Array of validation results for each address',
    type: [AddressValidationResult],
  })
  @Type(() => AddressValidationResult)
  results: AddressValidationResult[];

  @ApiProperty({
    description: 'Total number of addresses processed',
    example: 2,
  })
  total: number;

  @ApiProperty({
    description: 'Number of valid addresses',
    example: 1,
  })
  valid: number;

  @ApiProperty({
    description: 'Number of invalid addresses',
    example: 1,
  })
  invalid: number;
}
