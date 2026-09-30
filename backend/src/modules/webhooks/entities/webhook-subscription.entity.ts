import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Issuer } from '../../issuers/entities/issuer.entity';
import { WebhookLog } from './webhook-log.entity';

export enum WebhookEvent {
  CERTIFICATE_ISSUED = 'certificate.issued',
  CERTIFICATE_REVOKED = 'certificate.revoked',
  CERTIFICATE_VERIFIED = 'certificate.verified',
  CERTIFICATE_EXPIRED = 'certificate.expired',
  CERTIFICATE_FROZEN = 'certificate.frozen',
  CERTIFICATE_UNFROZEN = 'certificate.unfrozen',
  WEBHOOK_TEST = 'webhook.test',
}

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  issuerId: string;

  @ManyToOne(() => Issuer)
  @JoinColumn({ name: 'issuerId' })
  issuer: Issuer;

  @Column()
  url: string;

  @Column({
    type: 'enum',
    enum: WebhookEvent,
    array: true,
    default: [],
  })
  events: WebhookEvent[];

  /**
   * HMAC signing secret. Never expose after create (#719).
   * API responses use {@link sanitizeSubscription} which strips this field.
   */
  @Column()
  secret: string;

  /**
   * SHA-256 hash of the secret for storage integrity checks.
   * Not a substitute for the secret used in HMAC delivery.
   */
  @Column({ nullable: true })
  secretHash?: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => WebhookLog, (log) => log.subscription)
  logs: WebhookLog[];
}
