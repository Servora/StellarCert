import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds issuer-owned certificate templates (issue #1180).
 *
 * `GET /certificates/:id/pdf` rendered one fixed layout. Templates let an
 * issuer brand their certificates — logo, colours, signature image, and
 * per-field placement — stored alongside the other issuer-scoped metadata
 * (the `metadata_schemas` pattern: an `issuerId` column where NULL means a
 * system-wide row).
 *
 * `issuerId` is a plain varchar rather than a foreign key because it points
 * at `users.id`, matching how `certificates.issuerId` and
 * `metadata_schemas.issuerId` already reference users without a constraint.
 */
export class AddCertificateTemplates1784000100000 implements MigrationInterface {
  name = 'AddCertificateTemplates1784000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "certificate_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" text,
        "issuerId" character varying,
        "isActive" boolean NOT NULL DEFAULT true,
        "isDefault" boolean NOT NULL DEFAULT false,
        "titleText" character varying,
        "primaryColor" character varying NOT NULL DEFAULT '#1a365d',
        "accentColor" character varying NOT NULL DEFAULT '#b08d2e',
        "logoImage" text,
        "signatureImage" text,
        "orientation" character varying NOT NULL DEFAULT 'landscape',
        "layout" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_certificate_templates" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_certificate_templates_issuerId" ON "certificate_templates" ("issuerId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_certificate_templates_issuerId"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "certificate_templates"');
  }
}
