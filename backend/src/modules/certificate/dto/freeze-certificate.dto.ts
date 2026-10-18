import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body accepted by `PATCH /certificates/:id/freeze`.
 *
 * Every field is optional so existing callers that send only a `reason` keep
 * working, but the previously unvalidated loose `@Body('reason')` string is now
 * bounded and typed, and `durationDays` is coerced from its JSON/string form
 * and restricted to a sane range.
 */
export class FreezeCertificateDto {
  @ApiPropertyOptional({
    description: 'Reason recorded on the certificate freeze audit trail',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Days after which the freeze becomes eligible for automatic unfreeze',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;
}

/**
 * Body accepted by `PATCH /certificates/:id/unfreeze`.
 *
 * The reason stays optional and bounded; it is written to the certificate
 * metadata and echoed on the `certificate.unfrozen` webhook.
 */
export class UnfreezeCertificateDto {
  @ApiPropertyOptional({
    description: 'Reason recorded on the certificate unfreeze audit trail',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
