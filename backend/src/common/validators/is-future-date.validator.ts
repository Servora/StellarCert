import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Rejects dates that are not strictly in the future (#1247).
 *
 * `MinDate(new Date())` cannot be used here: its argument is evaluated once
 * when the DTO class is defined, so a long-running server would compare every
 * request against the process start time. This constraint evaluates "now" per
 * validation, and accepts both `Date` instances (after `@Type(() => Date)`)
 * and ISO strings (as `@IsDateString()` fields receive them).
 */
@ValidatorConstraint({ name: 'isFutureDate', async: false })
export class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    return date.getTime() > Date.now();
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a date in the future`;
  }
}

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsFutureDateConstraint,
    });
  };
}
