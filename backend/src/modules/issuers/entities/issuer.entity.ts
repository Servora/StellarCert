import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IssuerTier } from '../../../common/rate-limiting/rate-limit.types';

@Entity('issuers')
export class Issuer {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ unique: true })
  name: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ unique: true })
  stellarPublicKey: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ type: 'text', nullable: true })
  description?: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ default: true })
  isActive: boolean;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ nullable: true })
  website?: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ nullable: true })
  contactEmail?: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({
    type: 'enum',
    enum: IssuerTier,
    default: IssuerTier.FREE,
  })
  tier: IssuerTier;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ nullable: true, unique: true })
  apiKeyHash?: string;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @Column({ default: 0 })
  certificateCount: number;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TypeORM decorator signature incompatible with TS5
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
