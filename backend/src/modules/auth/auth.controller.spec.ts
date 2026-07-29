import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './services/two-factor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            register: jest.fn(),
          },
        },
        {
          provide: TwoFactorService,
          useValue: {
            generateSecret: jest.fn(),
            verifyToken: jest.fn(),
            generateQrCode: jest.fn(),
            enable: jest.fn(),
            disable: jest.fn(),
            verify: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have login method', () => {
    expect(controller.login).toBeDefined();
  });

  it('should have register method', () => {
    expect(controller.register).toBeDefined();
  });
});
