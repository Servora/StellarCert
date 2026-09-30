import { IsBoolean, IsInt, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RequestValidationPipe } from './request-validation.pipe';
import { ValidationException } from '../../../common/exceptions';
import { LogoutDto } from '../../auth/dto/logout.dto';

class SampleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count!: number;

  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  nested!: number;
}

describe('RequestValidationPipe', () => {
  let pipe: RequestValidationPipe;

  beforeEach(() => {
    pipe = new RequestValidationPipe();
  });

  it('returns the transformed DTO instance with coerced types (not raw sanitized value)', async () => {
    const input = { count: '5', active: 'true', nested: 2 };

    const result = await pipe.transform(input, {
      type: 'body',
      metatype: SampleDto,
      data: undefined,
    });

    expect(result).toBeInstanceOf(SampleDto);
    expect(typeof (result as SampleDto).count).toBe('number');
    expect((result as SampleDto).count).toBe(5);
    expect((result as SampleDto).active).toBe(true);
  });

  it('applies @Transform when returning the transformed instance', async () => {
    const input = { count: 3, active: 'true', nested: 0 };

    const result = await pipe.transform(input, {
      type: 'query',
      metatype: SampleDto,
      data: undefined,
    });

    expect(result).toBeInstanceOf(SampleDto);
    expect((result as SampleDto).active).toBe(true);
  });

  it('still throws ValidationException for invalid values', async () => {
    const input = { count: 'not-a-number', active: true, nested: -1 };

    await expect(
      pipe.transform(input, {
        type: 'body',
        metatype: SampleDto,
        data: undefined,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('accepts the optional access token in LogoutDto', async () => {
    const input = { accessToken: 'access-token' };

    const result = await pipe.transform(input, {
      type: 'body',
      metatype: LogoutDto,
      data: undefined,
    });

    expect(result).toBeInstanceOf(LogoutDto);
    expect((result as LogoutDto).accessToken).toBe('access-token');
  });

  it('returns the value unchanged when no metatype is provided', async () => {
    const input = 'plain-string';

    const result = await pipe.transform(input, {
      type: 'param',
      metatype: undefined,
      data: undefined,
    });

    expect(result).toBe(input);
  });
});
