import { Entity, PrimaryGeneratedColumn, ManyToOne, Column, CreateDateColumn } from 'typeorm';
import { Certificate } from './certificate.entity';

@Entity('verifications')
export class Verification {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Certificate)
    certificate: Certificate;

    @Column()
    success: boolean;

    @CreateDateColumn()
    verifiedAt: Date;
}
