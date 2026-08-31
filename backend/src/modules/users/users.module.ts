import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { RolesGuard } from './guards/roles.guard';
import { UserAuthService } from './services/user-auth.service';
import { UserProfileService } from './services/user-profile.service';
import { UserPasswordService } from './services/user-password.service';
import { UserAdminService } from './services/user-admin.service';
import { AuthModule } from '../auth/auth.module';
import { CertificateModule } from '../certificate/certificate.module';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    ConfigModule,
    forwardRef(() => AuthModule),
    forwardRef(() => CertificateModule),
    AuditModule,
    forwardRef(() => FilesModule),
    EmailModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    RolesGuard,
    UserAuthService,
    UserProfileService,
    UserPasswordService,
    UserAdminService,
  ],
  exports: [UsersService, UserRepository],
})
export class UsersModule {}