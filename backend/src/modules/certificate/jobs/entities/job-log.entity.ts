import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('job_logs')
export class JobLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  jobName: string;

  @Column()
  status: string; // pending, completed, failed

  @Column({ nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
