import { AddTransferConfirmationLockout1784000300000 } from './migrations/1784000300000-AddTransferConfirmationLockout';

describe('AddTransferConfirmationLockout', () => {
  const migration = new AddTransferConfirmationLockout1784000300000();

  const runner = () => {
    const query = jest.fn().mockResolvedValue(undefined);
    return { query } as never as {
      query: jest.Mock;
    } & import('typeorm').QueryRunner;
  };

  it('adds the locked label to the transfer status enum', async () => {
    const qr = runner();

    await migration.up(qr);

    const sql: string = qr.query.mock.calls[0][0];
    expect(sql).toContain(
      'ALTER TYPE "certificate_transfers_status_enum" ADD VALUE IF NOT EXISTS \'locked\'',
    );
  });

  it('adds the failed attempt counter and the lock timestamp', async () => {
    const qr = runner();

    await migration.up(qr);

    const statements: string[] = qr.query.mock.calls.map((call) => call[0]);
    expect(statements).toContainEqual(
      expect.stringContaining(
        'ALTER TABLE "certificate_transfers" ADD COLUMN IF NOT EXISTS "failedAttempts" integer NOT NULL DEFAULT 0',
      ),
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'ALTER TABLE "certificate_transfers" ADD COLUMN IF NOT EXISTS "lockedAt" timestamptz',
      ),
    );
  });

  it('runs outside a transaction because ALTER TYPE ... ADD VALUE cannot run in one', () => {
    expect(migration.transaction).toBe(false);
  });

  it('drops the columns again on rollback', async () => {
    const qr = runner();

    await migration.down(qr);

    const statements: string[] = qr.query.mock.calls.map((call) => call[0]);
    expect(statements).toContainEqual(
      expect.stringContaining(
        'ALTER TABLE "certificate_transfers" DROP COLUMN IF EXISTS "failedAttempts"',
      ),
    );
    expect(statements).toContainEqual(
      expect.stringContaining(
        'ALTER TABLE "certificate_transfers" DROP COLUMN IF EXISTS "lockedAt"',
      ),
    );
  });
});
