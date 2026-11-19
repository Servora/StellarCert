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
  ServiceUnavailableException,
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import { RateLimit } from '../security/decorators/rate-limit.decorator';

/**
 * Test deliveries send a real HTTP request to the subscription's URL, so they
 * are limited per issuer (falling back to the client IP when no user is
 * resolved yet) to stop the endpoint being used as a traffic generator.
 */
export const WEBHOOK_TEST_RATE_LIMIT = {
  limit: 5,
  windowMs: 60_000,
  keyBy: 'user',
} as const;

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
// Webhooks make the server call out to a URL the caller chooses, so they are an issuer feature.
@Roles(UserRole.ISSUER, UserRole.ADMIN)
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
  @RateLimit(WEBHOOK_TEST_RATE_LIMIT)
  @ApiOperation({ summary: 'Send a test webhook event' })
  async test(
    @CurrentUser('id') issuerId: string,
    @Body('subscriptionId') subscriptionId: string,
  ) {
    const subscription = await this.webhooksService.findOneWithSecret(
      subscriptionId,
      issuerId,
    );

    const queued = await this.webhooksService.triggerEventForSubscription(
      subscription,
      WebhookEvent.WEBHOOK_TEST,
      {
        message: 'Test webhook from StellarCert',
        test: true,
      },
    );

    if (!queued) {
      // Deliveries elsewhere are best-effort, but a test the caller asked for
      // must not claim success when nothing was queued.
      throw new ServiceUnavailableException(
        'Could not queue the test event; the webhook queue is unavailable',
      );
    }

    return { message: 'Test event queued successfully' };
  }

  @Post('test/sync')
  @RateLimit(WEBHOOK_TEST_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a test webhook now and return the endpoint outcome (status code, duration, response)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Delivery outcome. `success: false` means the endpoint rejected or did not answer the test, not that this request failed.',
  })
  async testSync(
    @CurrentUser('id') issuerId: string,
    @Body('subscriptionId') subscriptionId: string,
  ) {
    return this.webhooksService.testDeliverySync(subscriptionId, issuerId);
  }
}
