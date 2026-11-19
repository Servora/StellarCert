import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { ConvertTimestampsToTimestamptz1783000200000 } from './migrations/1783000200000-ConvertTimestampsToTimestamptz';

function entityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return entityFiles(path);
    return name.endsWith('.entity.ts') ? [path] : [];
  });
}

describe('ConvertTimestampsToTimestamptz', () => {
  const migration = new ConvertTimestampsToTimestamptz1783000200000();
  const runner = (type: string) => {
    const query = jest.fn();
    return { query, connection: { options: { type } } } as never as {
      query: jest.Mock;
    } & import('typeorm').QueryRunner;
  };

  it('converts every naive timestamp column, reading existing values as UTC', async () => {
    const qr = runner('postgres');

    await migration.up(qr);

    const sql: string = qr.query.mock.calls[0][0];
    expect(sql).toContain("data_type = 'timestamp without time zone'");
    expect(sql).toContain('TYPE timestamptz');
    expect(sql).toContain("AT TIME ZONE ''UTC''");
  });

  it('reverses through UTC', async () => {
    const qr = runner('postgres');

    await migration.down(qr);

    const sql: string = qr.query.mock.calls[0][0];
    expect(sql).toContain("data_type = 'timestamp with time zone'");
    expect(sql).toContain('TYPE timestamp ');
  });

  it('does nothing on other databases', async () => {
    const qr = runner('sqlite');

    await migration.up(qr);

    expect(qr.query).not.toHaveBeenCalled();
  });
});

describe('entity date columns', () => {
  beforeAll(() => {
    for (const file of entityFiles(join(__dirname, '..', '..'))) {
      require(file);
    }
  });

  it('declare timestamptz, so a non-UTC server cannot shift them', () => {
    const offenders = getMetadataArgsStorage()
      .columns.filter((column) => {
        const type = column.options.type;
        const isDate =
          column.mode === 'createDate' ||
          column.mode === 'updateDate' ||
          Reflect.getMetadata(
            'design:type',
            column.target instanceof Function
              ? column.target.prototype
              : column.target,
            column.propertyName,
          ) === Date;
        return isDate && type !== 'timestamptz';
      })
      .map(
        (column) =>
          `${(column.target as { name: string }).name}.${column.propertyName}`,
      );

    expect(offenders).toEqual([]);
  });
});
