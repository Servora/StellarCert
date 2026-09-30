import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { User, UserRole } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { IUserPublic } from '../interfaces/user.interface';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class UserProfileService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService,
  ) {}

  async getProfile(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if username is being changed and if it's already taken
    if (
      updateProfileDto.username &&
      updateProfileDto.username !== user.username
    ) {
      if (
        await this.userRepository.existsByUsername(updateProfileDto.username)
      ) {
        throw new ConflictException('Username already taken');
      }
    }

    // Check if Stellar public key is being changed and if it's already taken
    if (
      updateProfileDto.stellarPublicKey &&
      updateProfileDto.stellarPublicKey !== user.stellarPublicKey
    ) {
      if (
        await this.userRepository.existsByStellarPublicKey(
          updateProfileDto.stellarPublicKey,
        )
      ) {
        throw new ConflictException('Stellar public key already registered');
      }
    }

    const updatedUser = await this.userRepository.update(
      userId,
      updateProfileDto,
    );

    this.logger.log(`Profile updated for user: ${user.email}`);

    return updatedUser!;
  }

  async deleteProfile(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete
    await this.userRepository.softDelete(userId);

    this.logger.log(`Profile deleted (soft) for user: ${user.email}`);

    return { message: 'Account deactivated successfully' };
  }

  private toPublicUser(user: User): IUserPublic {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: user.profilePicture,
      role: user.role,
      stellarPublicKey: user.stellarPublicKey,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
    };
  }
}
