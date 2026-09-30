import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import {
  AdminUpdateUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  DeactivateUserDto,
} from '../dto/admin-user.dto';
import { UserFilterDto } from '../dto/pagination.dto';
import { IPaginatedResult } from '../interfaces';
import { LoggingService } from '../../../common/logging/logging.service';
import { CertificateStatsService } from '../../certificate/services/stats.service';
import { AuditService } from '../../audit/services/audit.service';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService,
    private readonly certificateStatsService: CertificateStatsService,
    private readonly auditService: AuditService,
  ) {}

  async findAllUsers(
    filterDto: UserFilterDto,
  ): Promise<IPaginatedResult<User>> {
    const { page, limit, sortBy, sortOrder, ...filters } = filterDto;

    return this.userRepository.findPaginated(
      { page: page || 1, limit: limit || 10 },
      filters,
      { field: sortBy || 'createdAt', order: sortOrder || 'DESC' },
    );
  }

  async findUserById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async adminUpdateUser(
    adminId: string,
    userId: string,
    updateDto: AdminUpdateUserDto,
  ): Promise<User> {
    // Prevent admin from modifying their own role
    if (adminId === userId && updateDto.role) {
      throw new ForbiddenException('Cannot modify your own role');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(userId, updateDto);

    this.logger.log(`Admin ${adminId} updated user ${userId}`);

    return updatedUser!;
  }

  async updateUserRole(
    adminId: string,
    userId: string,
    updateRoleDto: UpdateUserRoleDto,
  ): Promise<User> {
    // Prevent admin from modifying their own role
    if (adminId === userId) {
      throw new ForbiddenException('Cannot modify your own role');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(userId, {
      role: updateRoleDto.role,
    });

    this.logger.log(
      `Admin ${adminId} changed role of user ${userId} to ${updateRoleDto.role}`,
    );

    return updatedUser!;
  }

  async updateUserStatus(
    adminId: string,
    userId: string,
    updateStatusDto: UpdateUserStatusDto,
  ): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(userId, {
      status: updateStatusDto.status,
      isActive: updateStatusDto.status === UserStatus.ACTIVE,
    });

    this.logger.log(
      `Admin ${adminId} changed status of user ${userId} to ${updateStatusDto.status}`,
    );

    return updatedUser!;
  }

  async deactivateUser(
    adminId: string,
    userId: string,
    deactivateDto: DeactivateUserDto,
  ): Promise<User> {
    // Prevent admin from deactivating themselves
    if (adminId === userId) {
      throw new ForbiddenException('Cannot deactivate your own account');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(userId, {
      isActive: false,
      status: UserStatus.INACTIVE,
      metadata: {
        ...user.metadata,
        deactivationReason: deactivateDto.reason,
        deactivatedBy: adminId,
        deactivatedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Admin ${adminId} deactivated user ${userId}`);

    return updatedUser!;
  }

  async reactivateUser(adminId: string, userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userRepository.update(userId, {
      isActive: true,
      status: user.isEmailVerified
        ? UserStatus.ACTIVE
        : UserStatus.PENDING_VERIFICATION,
      metadata: {
        ...user.metadata,
        reactivatedBy: adminId,
        reactivatedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Admin ${adminId} reactivated user ${userId}`);

    return updatedUser!;
  }

  async deleteUser(
    adminId: string,
    userId: string,
  ): Promise<{ message: string }> {
    // Prevent admin from deleting themselves
    if (adminId === userId) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.delete(userId);

    this.logger.log(`Admin ${adminId} permanently deleted user ${userId}`);

    return { message: 'User deleted successfully' };
  }

  async getIssuerStats(userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.ISSUER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only issuers and admins can access issuer stats',
      );
    }

    // Get real statistics from certificate service
    const stats = await this.certificateStatsService.getStatistics({
      issuerId: userId,
    });

    return {
      totalCertificates: stats.totalCertificates,
      activeCertificates: stats.activeCertificates,
      revokedCertificates: stats.revokedCertificates,
      expiredCertificates: stats.expiredCertificates,
      totalVerifications: stats.verificationStats?.totalVerifications || 0,
      lastLogin: user.lastLoginAt || user.updatedAt,
    };
  }

  async getIssuerActivity(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.ISSUER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only issuers and admins can access activity logs',
      );
    }

    // Get real activity data from audit service
    const skip = (page - 1) * limit;
    const { data: activities, total } = await this.auditService.search({
      userId,
      skip,
      take: limit,
    });

    // Transform audit logs to match expected format
    const transformedActivities = activities.map((activity) => ({
      id: activity.id,
      action: activity.action,
      description: this.generateActivityDescription(activity),
      ipAddress: activity.ipAddress,
      userAgent: activity.userAgent,
      timestamp: new Date(activity.timestamp).toISOString(),
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      activities: transformedActivities,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  private generateActivityDescription(activity: any): string {
    switch (activity.action) {
      case 'ISSUE_CERTIFICATE':
        return `Issued certificate "${activity.resourceData?.title || activity.resourceId}"`;
      case 'REVOKE_CERTIFICATE':
        return `Revoked certificate #${activity.resourceId}`;
      case 'UPDATE_PROFILE':
        return 'Updated profile information';
      case 'LOGIN':
        return 'Logged into account';
      case 'LOGOUT':
        return 'Logged out of account';
      case 'CREATE_USER':
        return 'Created new user account';
      case 'UPDATE_USER':
        return 'Updated user information';
      case 'DELETE_USER':
        return 'Deleted user account';
      default:
        return `Performed ${activity.action.toLowerCase()} on ${activity.resourceType}`;
    }
  }

  async updateIssuerProfile(userId: string, updateDto: any): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.ISSUER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only issuers and admins can update issuer profile',
      );
    }

    // Check if username is already taken (if updating)
    if (updateDto.username && updateDto.username !== user.username) {
      if (await this.userRepository.existsByUsername(updateDto.username)) {
        throw new ConflictException('Username already taken');
      }
    }

    // Check if Stellar public key is already taken (if updating)
    if (
      updateDto.stellarPublicKey &&
      updateDto.stellarPublicKey !== user.stellarPublicKey
    ) {
      if (
        await this.userRepository.existsByStellarPublicKey(
          updateDto.stellarPublicKey,
        )
      ) {
        throw new ConflictException('Stellar public key already registered');
      }
    }

    // Update user fields
    const updateData: any = {};
    if (updateDto.firstName) updateData.firstName = updateDto.firstName;
    if (updateDto.lastName) updateData.lastName = updateDto.lastName;
    if (updateDto.username) updateData.username = updateDto.username;
    if (updateDto.phone) updateData.phone = updateDto.phone;
    if (updateDto.profilePicture)
      updateData.profilePicture = updateDto.profilePicture;
    if (updateDto.stellarPublicKey)
      updateData.stellarPublicKey = updateDto.stellarPublicKey;

    // Update metadata if organization is provided
    if (updateDto.organization !== undefined) {
      updateData.metadata = {
        ...user.metadata,
        organization: updateDto.organization,
      };
    }

    const updatedUser = await this.userRepository.update(userId, updateData);

    this.logger.log(`User ${userId} updated issuer profile`);

    return updatedUser;
  }
}
