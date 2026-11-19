import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Remembers how far the contract event indexer has read, so a restart resumes
 * from the last processed `getEvents` page instead of replaying or skipping.
 */
@Entity('contract_event_cursors')
export class ContractEventCursor {
  @PrimaryColumn()
  name: string;

  /** Opaque RPC paging token of the last processed event. */
  @Column({ type: 'text', nullable: true })
  cursor?: string | null;

  @Column({ type: 'int', nullable: true })
  lastLedger?: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
