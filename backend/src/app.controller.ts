import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Static liveness root - returns a constant string and reads nothing.
  // Load balancers and uptime checks hit it without credentials.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
