import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { typeOrmConfig } from './typeorm.config';

const backendRoot = join(__dirname, '..', '..');

describe('build and runtime paths', () => {
  const nestCli = JSON.parse(
    readFileSync(join(backendRoot, 'nest-cli.json'), 'utf-8'),
  );
  const assets: Array<{ include: string; outDir?: string }> =
    nestCli.compilerOptions.assets;

  it('copies every asset rule from a directory that exists', () => {
    for (const rule of assets) {
      const dir = join(backendRoot, 'src', rule.include.split('/**')[0]);
      expect(existsSync(dir)).toBe(true);
    }
  });

  it('does not re-nest the include path under outDir', () => {
    // Nest keeps the include path relative to sourceRoot below outDir, so a rule
    // that already names dist/<include> ends up at dist/<include>/<include>.
    for (const rule of assets) {
      const outDir = rule.outDir ?? 'dist';
      expect(outDir).not.toContain(rule.include.split('/**')[0]);
    }
  });

  it('ships the email templates the service loads', () => {
    const emailTemplates = assets.find((rule) =>
      rule.include.startsWith('modules/email/templates'),
    );
    expect(emailTemplates).toBeDefined();
    expect(
      existsSync(
        join(
          backendRoot,
          'src/modules/email/templates/transfer-confirmation.hbs',
        ),
      ),
    ).toBe(true);
  });

  it('loads migrations from the directory that actually holds them', () => {
    const [glob] = typeOrmConfig.migrations as string[];
    const dir = glob.slice(0, glob.lastIndexOf('/'));

    expect(existsSync(dir)).toBe(true);
    expect(dir.replace(/\\/g, '/')).toMatch(/\/database\/migrations$/);
  });
});
