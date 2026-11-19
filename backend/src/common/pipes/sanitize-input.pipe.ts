import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

@Injectable()
export class SanitizeInputPipe implements PipeTransform {
  private sanitize(value: any): any {
    if (typeof value === 'string') {
      return this.escapeHtml(value.trim());
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.sanitize(v));
    }

    if (value !== null && typeof value === 'object') {
      const sanitizedObj: any = {};
      for (const key of Object.keys(value)) {
        sanitizedObj[key] = this.sanitize(value[key]);
      }
      return sanitizedObj;
    }

    return value;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  transform(value: any, _metadata: ArgumentMetadata) {
    return this.sanitize(value);
  }
}
