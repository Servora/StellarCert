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

import { User } from '../../users/entities/user.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';

export interface VerificationHistoryRecord {
  verifiedAt: Date;
  verifiedBy: string;
  ipAddress: string;
  userAgent: string;
}

export interface CertificateMetadata {
  program?: string;
  course?: string;
  skills?: string[];
  grade?: string;
  hours?: number;
  issuedByOrganization?: string;
  revocationReason?: string;
  revokedAt?: Date;
  freezeReason?: string;
  frozenAt?: Date;
  freezeDurationDays?: number;
  unfreezeAt?: Date;
  unfreezeReason?: string;
  unfrozenAt?: Date;
  additionalFields?: Record<string, unknown>;
}

@Entity('certificates')
export class Certificate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  certificateId: string; // Human-readable unique ID, e.g. CERT-2024-AB12CD34

  @Column()
  @Index()
  issuerId: string;

  @Column({ nullable: true })
  @Index()
  recipientId?: string;

  @Column()
  @Index()
  recipientEmail: string;

  @Column()
  @Index()
  recipientName: string;

  @Column({ nullable: true })
  recipientStellarAddress?: string;

  @Column({ nullable: true })
  issuerName?: string;

  @Column({ nullable: true })
  issuerStellarAddress?: string;

  @Column()
  @Index()
  title: string;

  @Column({ nullable: true })
  @Index()
  courseName: string;

  @Column({ nullable: true })
  @Index()
  templateId: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: CertificateMetadata;

  @Column({
    type: 'enum',
    enum: CertificateStatus,
    default: CertificateStatus.ACTIVE,
  })
  status: CertificateStatus;

  @Column({ nullable: true })
  revocationReason?: string;

  @Column({ nullable: true })
  revokedAt?: Date;

  @Column({ nullable: true })
  revokedBy?: string;

  // Legacy field kept for backward compatibility
  @Column({ nullable: true })
  stellarTransactionId?: string;

  @Column({ nullable: true, unique: true })
  @Index()
  stellarTransactionHash?: string;

  @Column({ type: 'text', nullable: true })
  stellarMemo?: string;

  @Column({ type: 'bigint', nullable: true })
  stellarSequenceNumber?: string;

  @Column({ nullable: true, unique: true })
  @Index()
  verificationCode?: string;

  @Column({ type: 'jsonb', nullable: true })
  verificationHistory?: VerificationHistoryRecord[];

  @Column({ default: 0 })
  verificationCount: number;

  @Column({ nullable: true, type: 'text' })
  qrCodeData?: string;

  @Column({ nullable: true })
  pdfUrl?: string;

  @Column({ nullable: true })
  qrCodeUrl?: string;

  @Column({ default: false })
  isDuplicate: boolean;

  @Column({ nullable: true })
  duplicateOfId?: string;

  @Column({ nullable: true })
  overrideReason?: string;

  @Column({ nullable: true })
  overriddenBy?: string;

  @Column({ nullable: true })
  metadataSchemaId?: string;

  @CreateDateColumn()
  issuedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issuerId' })
  issuer: User;

  // ─── Business logic helpers ──────────────────────────────────────────────────

  isActive(): boolean {
    return this.status === CertificateStatus.ACTIVE;
  }

  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
  }

  canBeRevoked(): boolean {
    return this.status === CertificateStatus.ACTIVE;
  }

  addVerificationRecord(
    verifiedBy: string,
    ipAddress: string,
    userAgent: string,
  ): void {
    if (!this.verificationHistory) {
      this.verificationHistory = [];
    }
    this.verificationHistory.push({
      verifiedAt: new Date(),
      verifiedBy,
      ipAddress,
      userAgent,
    });
    this.verificationCount = (this.verificationCount ?? 0) + 1;
  }
}
