import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `User.role` defaulted to `issuer`, so any insert that omitted the role (admin creation, seeds,
 * a direct repository.create) produced an account able to issue certificates. The default is now
 * `user`. Existing rows are NOT changed: their roles may have been set deliberately.
 */
export class DefaultUserRoleToUser1783100000000 implements MigrationInterface {
  name = 'DefaultUserRoleToUser1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'issuer'`,
    );
  }
}
