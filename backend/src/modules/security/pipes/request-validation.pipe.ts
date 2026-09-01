import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  ValidationError,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationException } from '../../../common/exceptions';

type Constructor<T = unknown> = new (...args: unknown[]) => T;

@Injectable()
export class RequestValidationPipe implements PipeTransform {
  async transform(value: unknown, { metatype }: ArgumentMetadata) {
    const sanitizedValue = this.sanitizeInput(value);

    if (!metatype || !this.toValidate(metatype)) {
      return sanitizedValue;
    }

    const object = plainToClass(metatype, sanitizedValue);
    const errors = await validate(object, {
      skipMissingProperties: false,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      throw new ValidationException(
        'Request validation failed',
        this.formatErrors(errors),
      );
    }

    return object;
  }

  private toValidate(metatype: Constructor): boolean {
    const types: Constructor[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }

  private sanitizeInput(value: unknown): unknown {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .split('')
        .filter((char) => {
          const code = char.charCodeAt(0);
          return code >= 32 && code !== 127;
        })
        .join('')
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeInput(item));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce(
        (acc, [key, currentValue]) => {
          acc[key] = this.sanitizeInput(currentValue);
          return acc;
        },
        {} as Record<string, unknown>,
      );
    }

    return value;
  }

  private formatErrors(
    errors: ValidationError[],
  ): Array<{ field: string; constraints: Record<string, string> }> {
    const formattedErrors: Array<{
      field: string;
      constraints: Record<string, string>;
    }> = [];

    const traverse = (errs: ValidationError[], prefix = '') => {
      errs.forEach((error) => {
        const field = prefix ? `${prefix}.${error.property}` : error.property;
        if (error.constraints) {
          formattedErrors.push({
            field,
            constraints: error.constraints,
          });
        }
        if (error.children && error.children.length > 0) {
          traverse(error.children, field);
        }
      });
    };

    traverse(errors);
    return formattedErrors;
  }
}
