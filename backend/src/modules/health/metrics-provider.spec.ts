import 'reflect-metadata';
import { CommonModule } from '../../common/common.module';
import { MetricsService } from '../../common/monitoring/metrics.service';
import { HealthModule } from './health.module';

describe('MetricsService provisioning', () => {
  it('is provided and exported by CommonModule only', () => {
    const common: unknown[] = Reflect.getMetadata('providers', CommonModule);
    const commonExports: unknown[] = Reflect.getMetadata(
      'exports',
      CommonModule,
    );
    const health: unknown[] = Reflect.getMetadata('providers', HealthModule);

    expect(common).toContain(MetricsService);
    expect(commonExports).toContain(MetricsService);
    expect(health).not.toContain(MetricsService);
  });
});
