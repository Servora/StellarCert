import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `ownerId` column to `metadata_schemas`.
 *
 * The metadata-schema write endpoints previously had no role checks and no
 * notion of ownership, so any authenticated user could rewrite or deactivate
 * the schemas issuers validate against. The column records who created a
 * schema, and the service now only lets that user (or an admin) modify it.
 *
 * Nullable: rows that predate this migration have no trustworthy owner. The
 * old `issuerId` column was caller-supplied and therefore cannot be used to
 * backfill ownership safely, so those rows are admin-managed.
 */
export class AddMetadataSchemaOwner1784000200000 implements MigrationInterface {
  name = 'AddMetadataSchemaOwner1784000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "metadata_schemas" ADD COLUMN IF NOT EXISTS "ownerId" character varying',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_metadata_schemas_ownerId" ON "metadata_schemas" ("ownerId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_metadata_schemas_ownerId"',
    );
    await queryRunner.query(
      'ALTER TABLE "metadata_schemas" DROP COLUMN IF EXISTS "ownerId"',
    );
  }
}
