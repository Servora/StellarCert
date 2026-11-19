import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts every `timestamp without time zone` column to `timestamptz`.
 *
 * The initial schema created the date columns as plain `TIMESTAMP`. Postgres
 * (running in UTC) stores `now()` as UTC wall-clock time, but `pg` reads a
 * `timestamp` back as the Node process's *local* time. On any host whose `TZ`
 * is not UTC, issue dates, verification history and audit ordering were shifted
 * by the server's UTC offset, while values set from JavaScript (such as
 * `expiresAt`) still read back correctly, so the two disagreed.
 *
 * Existing values are interpreted as UTC (`AT TIME ZONE 'UTC'`), which is what
 * the database wrote for every `DEFAULT now()` / `@CreateDateColumn` value. The
 * columns are discovered from `information_schema` so none can be missed.
 *
 * `down` converts all `timestamptz` columns back to `timestamp`, again through
 * UTC; the schema had none before this migration.
 */
export class ConvertTimestampsToTimestamptz1783000200000 implements MigrationInterface {
  name = 'ConvertTimestampsToTimestamptz1783000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.convert(
      queryRunner,
      'timestamp without time zone',
      'timestamptz',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.convert(queryRunner, 'timestamp with time zone', 'timestamp');
  }

  private async convert(
    queryRunner: QueryRunner,
    fromType: string,
    toType: string,
  ): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;

    await queryRunner.query(`
      DO $$
      DECLARE col record;
      BEGIN
        FOR col IN
          SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = current_schema()
            AND t.table_type = 'BASE TABLE'
            AND c.data_type = '${fromType}'
            AND c.table_name <> 'migrations'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN %I TYPE ${toType} USING %I AT TIME ZONE ''UTC''',
            col.table_name, col.column_name, col.column_name
          );
        END LOOP;
      END
      $$;
    `);
  }
}
