import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  SelectQueryBuilder,
  FindOptionsWhere,
  ILike,
  Not,
  IsNull,
} from 'typeorm';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { IPaginatedResult, IPaginationOptions } from '../interfaces';
import { IUserFilter, ISortOptions } from '../interfaces/user.interface';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = this.repository.create(userData);
    return this.repository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id })
      .getOne();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.repository.findOne({ where: { username } });
  }

  async findByStellarPublicKey(stellarPublicKey: string): Promise<User | null> {
    return this.repository.findOne({ where: { stellarPublicKey } });
  }

  async findByEmailVerificationToken(token: string): Promise<User | null> {
    return this.repository.findOne({
      where: { emailVerificationToken: token },
    });
  }

  async findUsersWithPasswordResetTokens(): Promise<User[]> {
    return this.repository.find({
      where: { passwordResetToken: Not(IsNull()) },
    });
  }

  async findByPasswordResetTokenHash(
    passwordResetTokenHash: string,
  ): Promise<User | null> {
    return this.repository.findOne({
      where: { passwordResetTokenHash },
    });
  }

  async findByRefreshToken(refreshToken: string): Promise<User | null> {
    return this.repository.findOne({ where: { refreshToken } });
  }

  async update(id: string, userData: Partial<User>): Promise<User | null> {
    await this.repository.update(id, userData);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected !== 0;
  }

  async softDelete(id: string): Promise<User | null> {
    await this.repository.update(id, {
      isActive: false,
      status: UserStatus.INACTIVE,
    });
    return this.findById(id);
  }

  async findAll(): Promise<User[]> {
    return this.repository.find();
  }

  async findPaginated(
    pagination: IPaginationOptions,
    filter?: IUserFilter,
    sort?: ISortOptions,
  ): Promise<IPaginatedResult<User>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const queryBuilder = this.repository.createQueryBuilder('user');

    // Apply filters
    if (filter) {
      this.applyFilters(queryBuilder, filter);
    }

    // Apply sorting
    const sortField = this.sanitizeSortField(sort?.field);
    const sortOrder = sort?.order || 'DESC';
    queryBuilder.orderBy(`user.${sortField}`, sortOrder);

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    const data = await queryBuilder.getMany();

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  private applyFilters(
    queryBuilder: SelectQueryBuilder<User>,
    filter: IUserFilter,
  ): void {
    if (filter.search) {
      queryBuilder.andWhere(
        '(user.email ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.username ILIKE :search)',
        { search: `%${filter.search}%` },
      );
    }

    if (filter.email) {
      queryBuilder.andWhere('user.email ILIKE :email', {
        email: `%${filter.email}%`,
      });
    }

    if (filter.firstName) {
      queryBuilder.andWhere('user.firstName ILIKE :firstName', {
        firstName: `%${filter.firstName}%`,
      });
    }

    if (filter.lastName) {
      queryBuilder.andWhere('user.lastName ILIKE :lastName', {
        lastName: `%${filter.lastName}%`,
      });
    }

    if (filter.role) {
      queryBuilder.andWhere('user.role = :role', { role: filter.role });
    }

    if (filter.status) {
      queryBuilder.andWhere('user.status = :status', { status: filter.status });
    }

    if (filter.isActive !== undefined) {
      queryBuilder.andWhere('user.isActive = :isActive', {
        isActive: filter.isActive,
      });
    }

    if (filter.isEmailVerified !== undefined) {
      queryBuilder.andWhere('user.isEmailVerified = :isEmailVerified', {
        isEmailVerified: filter.isEmailVerified,
      });
    }
  }

  async countByRole(role: UserRole): Promise<number> {
    return this.repository.count({ where: { role } });
  }

  async countByStatus(status: UserStatus): Promise<number> {
    return this.repository.count({ where: { status } });
  }

  async countActive(): Promise<number> {
    return this.repository.count({ where: { isActive: true } });
  }

  async countTotal(): Promise<number> {
    return this.repository.count();
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.repository.count({ where: { email } });
    return count > 0;
  }

  async existsByUsername(username: string): Promise<boolean> {
    const count = await this.repository.count({ where: { username } });
    return count > 0;
  }

  async existsByStellarPublicKey(stellarPublicKey: string): Promise<boolean> {
    const count = await this.repository.count({ where: { stellarPublicKey } });
    return count > 0;
  }

  async incrementLoginAttempts(id: string): Promise<void> {
    await this.repository.increment({ id }, 'loginAttempts', 1);
  }

  async resetLoginAttempts(id: string): Promise<void> {
    await this.repository.update(id, {
      loginAttempts: 0,
      lockedUntil: undefined,
    });
  }

  async lockAccount(id: string, until: Date): Promise<void> {
    await this.repository.update(id, { lockedUntil: until });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.repository.update(id, { lastLoginAt: new Date() });
  }

  async getPerUserCertificateCounts(): Promise<Record<string, number>> {
    const rawData = await this.repository
      .createQueryBuilder('user')
      .leftJoin('certificates', 'cert', 'cert."issuerId" = user.id')
      .select('user.id', 'userId')
      .addSelect('COUNT(cert.id)', 'count')
      .groupBy('user.id')
      .getRawMany();

    const result: Record<string, number> = {};
    rawData.forEach((row) => {
      result[row.userId] = parseInt(row.count, 10);
    });
    return result;
  }

  private sanitizeSortField(field?: string): string {
    const allowed = [
      'createdAt',
      'updatedAt',
      'email',
      'firstName',
      'lastName',
      'role',
      'status',
      'lastLoginAt',
    ];
    return field && allowed.includes(field) ? field : 'createdAt';
  }
}
