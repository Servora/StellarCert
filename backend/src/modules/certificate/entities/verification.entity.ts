import { Certificate } from './certificate.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('verifications')
export class Verification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Certificate)
  certificate: Certificate;

  @Column()
  success: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  verifiedAt: Date;
}
