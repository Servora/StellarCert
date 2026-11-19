import { User } from '../entities/user.entity';
import { UserResponseDto } from '../dto/user-response.dto';
import { IUserPublic } from '../interfaces/user.interface';

/** Public profile shape; never includes credentials or token hashes. */
export function toPublicUser(user: User): IUserPublic {
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

/**
 * Admin-safe user shape. Keeps the operational fields the admin UI needs while
 * dropping every credential/token column from the entity.
 */
export function toAdminUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    profilePicture: user.profilePicture,
    role: user.role,
    status: user.status,
    stellarPublicKey: user.stellarPublicKey,
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
