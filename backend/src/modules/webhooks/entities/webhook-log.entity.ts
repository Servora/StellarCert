import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookSubscription } from './webhook-subscription.entity';

@Entity('webhook_logs')
export class WebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  subscriptionId: string;

  @ManyToOne(() => WebhookSubscription, (sub) => sub.logs)
  @JoinColumn({ name: 'subscriptionId' })
  subscription: WebhookSubscription;

  @Column()
  event: string;

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ nullable: true })
  statusCode: number;

  @Column({ type: 'text', nullable: true })
  response: string;

  @Column({ nullable: true })
  duration: number;

  @Column({ default: 1 })
  attempt: number;

  @Column({ default: false })
  isSuccess: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
