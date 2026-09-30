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

  @Column({ nullable: true, unique: true })
  confirmationCode?: string;

  @Column({ nullable: true })
  initiatedBy: string;

  @CreateDateColumn()
  initiatedAt: Date;

  @UpdateDateColumn()
  completedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;
}
