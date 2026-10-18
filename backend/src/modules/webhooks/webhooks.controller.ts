import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { WebhookEvent } from './entities/webhook-subscription.entity';
import { JwtAuthGuard } from 'src/common';
import { CurrentUser } from '../users/decorators/current-user.decorator';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new webhook subscription' })
  @ApiResponse({ status: 201, description: 'Webhook registered successfully' })
  async create(
    @CurrentUser('id') issuerId: string,
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    return this.webhooksService.createSubscription(issuerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all webhook subscriptions for the issuer' })
  async findAll(@CurrentUser('id') issuerId: string) {
    return this.webhooksService.findAll(issuerId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a webhook subscription' })
  async remove(
    @CurrentUser('id') issuerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.webhooksService.remove(id, issuerId);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get delivery logs for a webhook subscription' })
  async getLogs(
    @CurrentUser('id') issuerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const pageNum = page ? Math.max(1, Number(page)) : 1;
    const limitNum = limit ? Math.min(100, Math.max(1, Number(limit))) : 50;
    return this.webhooksService.getLogs(id, issuerId, pageNum, limitNum);
  }

  @Post('test')
  @ApiOperation({ summary: 'Send a test webhook event' })
  async test(
    @CurrentUser('id') issuerId: string,
    @Body('subscriptionId') subscriptionId: string,
  ) {
    const subscription = await this.webhooksService.findOneWithSecret(
      subscriptionId,
      issuerId,
    );

    await this.webhooksService.triggerEventForSubscription(
      subscription,
      WebhookEvent.WEBHOOK_TEST,
      {
        message: 'Test webhook from StellarCert',
        test: true,
      },
    );

    return { message: 'Test event queued successfully' };
  }
}
