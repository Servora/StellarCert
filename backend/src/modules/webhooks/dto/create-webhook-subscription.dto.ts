import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsUrl,
  IsArray,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';
import { WebhookEvent } from '../entities/webhook-subscription.entity';

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    example: 'https://api.example.com/webhooks',
    description: 'The URL where the webhook will be delivered (must be HTTPS)',
  })
  @IsUrl({
    require_protocol: true,
    protocols: ['https'],
    require_valid_protocol: true,
    require_host: true,
    allow_fragments: false,
    allow_query_components: true,
  })
  @Matches(/^https:\/\//i, {
    message: 'Only HTTPS URLs are allowed for webhooks',
  })
  @MaxLength(2048)
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    enum: WebhookEvent,
    isArray: true,
    example: [WebhookEvent.CERTIFICATE_ISSUED],
    description: 'List of events to subscribe to',
  })
  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  events: WebhookEvent[];

  @ApiProperty({
    required: false,
    description: 'Whether the webhook is active',
    default: true,
  })
  @IsOptional()
  isActive?: boolean;
  
}
