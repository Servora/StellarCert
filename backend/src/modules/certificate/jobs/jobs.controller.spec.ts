import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobsService } from './services/jobs.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../users/guards/roles.guard';

describe('JobsController', () => {
  let controller: JobsController;
  let jobsService: jest.Mocked<JobsService>;

  beforeEach(async () => {
    const mockJobsService = {
      enqueueEmailJob: jest.fn(),
      enqueuePdfJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: JobsService, useValue: mockJobsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<JobsController>(JobsController);
    jobsService = module.get(JobsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should restrict access with JwtAuthGuard and RolesGuard', () => {
    const guards = Reflect.getMetadata('__guards__', controller.enqueueEmail);
    const hasJwtGuard = guards.some((guard: any) => guard.name === 'JwtAuthGuard' || guard === JwtAuthGuard);
    const hasRolesGuard = guards.some((guard: any) => guard.name === 'RolesGuard' || guard === RolesGuard);

    expect(hasJwtGuard).toBe(true);
    expect(hasRolesGuard).toBe(true);
  });
});
