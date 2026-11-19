import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class InputSanitizationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    req.body = this.sanitize(req.body);
    const sanitizedQuery = this.sanitize(req.query) as Record<string, unknown>;
    for (const key of Object.keys(sanitizedQuery)) {
      (req.query as Record<string, unknown>)[key] = sanitizedQuery[key];
    }
    req.params = this.sanitize(req.params);

    next();
  }

  private sanitize(value: unknown): any {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .split('')
        .filter((char) => {
          const code = char.charCodeAt(0);
          // Drop control characters, but keep tab (9), newline (10) and carriage return (13)
          // so multi-line descriptions and addresses survive.
          return code >= 32
            ? code !== 127
            : code === 9 || code === 10 || code === 13;
        })
        .join('')
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce(
        (acc, [key, currentValue]) => {
          acc[key] = this.sanitize(currentValue);
          return acc;
        },
        {} as Record<string, unknown>,
      );
    }

    return value;
  }
}
