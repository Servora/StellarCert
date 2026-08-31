import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';
import * as crypto from 'crypto';

export interface CacheOptions {
  maxAge?: number; // in seconds
  staleWhileRevalidate?: number; // in seconds
  mustRevalidate?: boolean;
  noCache?: boolean;
}

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private static generateETag(data: any): string {
    const str = JSON.stringify(data);
    return crypto.createHash('md5').update(str).digest('hex');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();

    // Check if the route is marked as cacheable via custom decorator
    const cacheOptions = this.getCacheOptions(context);

    if (cacheOptions.noCache) {
      response.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate',
      );
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (cacheOptions) {
          const etag = CacheInterceptor.generateETag(data);

          // Check if client has the same ETag
          const clientEtag = request.get('if-none-match');
          if (clientEtag === etag) {
            response.status(304);
            response.end();
            return null;
          }

          // Set ETag header
          response.setHeader('ETag', `"${etag}"`);

          // Set Cache-Control header
          const directives: string[] = [];
          if (cacheOptions.maxAge) {
            directives.push(`max-age=${cacheOptions.maxAge}`);
          }
          if (cacheOptions.staleWhileRevalidate) {
            directives.push(
              `stale-while-revalidate=${cacheOptions.staleWhileRevalidate}`,
            );
          }
          if (cacheOptions.mustRevalidate) {
            directives.push('must-revalidate');
          }
          if (directives.length === 0) {
            directives.push('no-cache');
          }
          response.setHeader('Cache-Control', directives.join(', '));
        }

        return data;
      }),
    );
  }

  private getCacheOptions(context: ExecutionContext): CacheOptions {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check for decorator metadata (can be extended with custom decorators)
    return (
      Reflect.getMetadata('cacheOptions', handler) ||
      Reflect.getMetadata('cacheOptions', classRef) ||
      this.getDefaultCacheOptions(context)
    );
  }

  private getDefaultCacheOptions(
    context: ExecutionContext,
  ): CacheOptions | null {
    const request = context.switchToHttp().getRequest();
    const route = request.route?.path;

    // Define which routes should be cached by default
    const cacheableRoutes = ['/stats/summary', '/issuers', '/metadata-schemas'];

    if (cacheableRoutes.some((r) => route?.includes(r))) {
      return {
        maxAge: 300, // 5 minutes
        staleWhileRevalidate: 600, // 10 minutes
      };
    }

    return null;
  }
}
