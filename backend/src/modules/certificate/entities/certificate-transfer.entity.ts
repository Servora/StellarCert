import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Certificate } from './certificate.entity';

export enum TransferStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  /**
   * Set when the confirmation code was guessed wrong too many times. The
   * transfer can no longer be approved; it has to be cancelled and initiated
   * again so a fresh confirmation code is issued.
   */
  LOCKED = 'locked',
}

@Entity('certificate_transfers')
@Index(['certificateId'])
@Index(['fromEmail'])
@Index(['toEmail'])
@Index(['status'])
export class CertificateTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  certificateId: string;

  @ManyToOne(() => Certificate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'certificateId' })
  certificate: Certificate;

  @Column()
  fromEmail: string;

  @Column()
  fromName: string;

  @Column()
  toEmail: string;

  @Column()
  toName: string;

  @Column({
    type: 'enum',
    enum: TransferStatus,
    default: TransferStatus.PENDING,
  })
  status: TransferStatus;

  @Column({ nullable: true })
  reason?: string;

  @Column({ nullable: true })
  rejectionReason?: string;

  // Secret confirmation code. Never selected by default so it cannot accidentally
  // be serialized in any API response. Codes that need it (e.g. approval) must
  // explicitly addSelect('confirmationCode').
  @Column({ nullable: true, unique: true, select: false })
  confirmationCode?: string;

  @Column({ nullable: true })
  initiatedBy: string;

  /**
   * Number of confirmation codes that were submitted and did not match. The
   * transfer is locked once the count reaches the configured maximum.
   */
  @Column({ type: 'int', default: 0 })
  failedAttempts: number;

  /** When the transfer was locked after too many failed attempts. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  initiatedAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  completedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date;
}
