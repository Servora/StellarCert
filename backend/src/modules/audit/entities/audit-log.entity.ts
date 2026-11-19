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
// @Index(['resourceId']) // Keep commented for now
@Index(['createdAt'])
@Index(['timestamp'])
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

  // FIX: Add explicit type for resourceId
  @Column({
    nullable: true,
    type: 'varchar', // This tells TypeORM to use PostgreSQL VARCHAR
  })
  resourceId: string | null;

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
  } | null;

  // Also fix userId for consistency
  @Column({
    nullable: true,
    type: 'varchar',
  })
  userId: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userEmail: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userRole: string | null;

  @Column({
    nullable: false,
    type: 'varchar',
  })
  ipAddress: string;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userAgent: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  correlationId: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  transactionHash: string | null;

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

  @Column({
    nullable: true,
    type: 'varchar',
  })
  errorMessage: string | null;

  @Column({
    type: 'bigint',
  })
  timestamp: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
