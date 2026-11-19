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
    // Input is sanitized once, by InputSanitizationMiddleware. This pipe only validates.
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    // A body-less request (POST /auth/logout, for instance) arrives as
    // undefined. plainToClass then yields undefined and class-validator
    // dereferences it - "Cannot read properties of undefined (reading
    // 'constructor')" - which surfaced as a 500 on an ordinary logout.
    // Validating an empty object instead keeps DTOs with required fields
    // failing as proper 400s while letting empty-bodied DTOs through.
    const object = plainToClass(metatype, value ?? {});
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
