import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores the contract event indexer's `getEvents` cursor. */
export class CreateContractEventCursors1783000300000 implements MigrationInterface {
  name = 'CreateContractEventCursors1783000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contract_event_cursors" (
        "name" character varying NOT NULL,
        "cursor" text,
        "lastLedger" integer,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_event_cursors_name" PRIMARY KEY ("name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "contract_event_cursors"');
  }
}
