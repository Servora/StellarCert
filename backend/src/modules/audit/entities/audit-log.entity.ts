import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AuditAction, AuditResourceType } from '../constants';

@Entity('audit_logs')
@Index(['userId'])
@Index(['action'])
@Index(['resourceType'])
@Index(['resourceId'])
@Index(['createdAt'])
@Index(['correlationId'])
@Index(['ipAddress'])
@Index(['status'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    nullable: false,
  })
  action: AuditAction;

  @Column({
    type: 'enum',
    enum: AuditResourceType,
    nullable: false,
  })
  resourceType: AuditResourceType;

  @Column({ nullable: true })
  resourceId: string;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  resourceData: any;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  changes: {
    before?: any;
    after?: any;
  };

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  userEmail: string;

  @Column({ nullable: true })
  userRole: string;

  @Column({ nullable: false })
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ nullable: true })
  correlationId: string;

  @Column({ nullable: true })
  transactionHash: string; // For Stellar transactions

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  metadata: Record<string, any>;

  @Column({
    default: 'success',
    type: 'varchar',
  })
  status: 'success' | 'failure' | 'error';

  @Column({ nullable: true })
  errorMessage: string;

  @Column({
    type: 'bigint',
  })
  timestamp: number; // Unix timestamp for precise ordering

  @CreateDateColumn()
  createdAt: Date;
}
