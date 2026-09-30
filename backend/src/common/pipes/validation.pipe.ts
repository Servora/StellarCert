import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { validate, ValidationError } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ValidationException } from '../exceptions';

type Constructor<T = any> = new (...args: any[]) => T;

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToClass(metatype, value);
    const errors = await validate(object, {
      skipMissingProperties: false,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const formattedErrors = this.formatErrors(errors);
      throw new ValidationException('Validation failed', formattedErrors);
    }

    return value;
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
