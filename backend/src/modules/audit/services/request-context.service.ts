import { Injectable } from '@nestjs/common';
import { IRequestContext } from '../interfaces';

@Injectable()
export class RequestContextService {
  private requestContext = new Map<string, IRequestContext>();

  setContext(id: string, context: IRequestContext): void {
    this.requestContext.set(id, context);
  }

  getContext(id: string): IRequestContext | undefined {
    return this.requestContext.get(id);
  }

  deleteContext(id: string): void {
    this.requestContext.delete(id);
  }

  clearContext(): void {
    this.requestContext.clear();
  }
}
