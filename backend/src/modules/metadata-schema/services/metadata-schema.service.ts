import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MetadataSchema,
  SchemaField,
  FieldType,
} from '../entities/metadata-schema.entity';
import {
  CreateMetadataSchemaDto,
  UpdateMetadataSchemaDto,
  SchemaFieldDto,
  ValidationErrorDetail,
  MetadataValidationResultDto,
} from '../dto/metadata-schema.dto';
import { LoggingService } from '../../../common/logging/logging.service';
import { UserRole } from '../../../common/constants/roles';

const MAX_PATTERN_LENGTH = 200;

/**
 * Rejects patterns that do not compile or that look prone to catastrophic backtracking
 * (a quantified group that itself contains a quantifier, such as `(a+)+$`). This is a
 * conservative heuristic, not a proof; a linear-time engine such as `re2` would be stronger.
 */
export function assertSafePattern(fieldName: string, pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new BadRequestException(
      `Pattern for field "${fieldName}" is longer than ${MAX_PATTERN_LENGTH} characters`,
    );
  }
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(pattern)) {
    throw new BadRequestException(
      `Pattern for field "${fieldName}" contains nested quantifiers and is not allowed`,
    );
  }
  try {
    return new RegExp(pattern);
  } catch {
    throw new BadRequestException(
      `Pattern for field "${fieldName}" is not a valid regular expression`,
    );
  }
}

@Injectable()
export class MetadataSchemaService {
  constructor(
    @InjectRepository(MetadataSchema)
    private readonly schemaRepository: Repository<MetadataSchema>,
    private readonly logger: LoggingService,
  ) {}

  async create(
    dto: CreateMetadataSchemaDto,
    ownerId: string,
  ): Promise<MetadataSchema> {
    dto.fields?.forEach(
      (f) => f.pattern && assertSafePattern(f.name, f.pattern),
    );
    const existing = await this.schemaRepository.findOne({
      where: { name: dto.name, version: dto.version },
    });

    if (existing) {
      throw new ConflictException(
        `Schema "${dto.name}" version ${dto.version} already exists`,
      );
    }

    const requiredFields =
      dto.requiredFields ??
      dto.fields.filter((f) => f.required).map((f) => f.name);

    const previous = await this.findLatestByName(dto.name);

    const schema = this.schemaRepository.create({
      ...dto,
      ownerId,
      requiredFields,
      allowCustomFields: dto.allowCustomFields ?? true,
      previousVersionId: previous?.id,
    });

    const saved = await this.schemaRepository.save(schema);
    this.logger.log(`Schema created: ${saved.name} v${saved.version}`);
    return saved;
  }

  async findAll(issuerId?: string): Promise<MetadataSchema[]> {
    const where: any = { isActive: true };
    if (issuerId) where.issuerId = issuerId;
    return this.schemaRepository.find({
      where,
      order: { name: 'ASC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<MetadataSchema> {
    const schema = await this.schemaRepository.findOne({ where: { id } });
    if (!schema) throw new NotFoundException(`Schema ${id} not found`);
    return schema;
  }

  async findByName(name: string): Promise<MetadataSchema[]> {
    return this.schemaRepository.find({
      where: { name, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findLatestByName(name: string): Promise<MetadataSchema | null> {
    return this.schemaRepository.findOne({
      where: { name, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    dto: UpdateMetadataSchemaDto,
    actorId: string,
    actorRole?: string,
  ): Promise<MetadataSchema> {
    const schema = await this.findOne(id);
    this.assertCanModify(schema, actorId, actorRole);

    // (name, version) is the uniqueness key that create/upgradeSchema rely on, so it is immutable.
    if (
      (dto.name !== undefined && dto.name !== schema.name) ||
      (dto.version !== undefined && dto.version !== schema.version)
    ) {
      throw new BadRequestException(
        'name and version cannot be changed; create a new version with upgradeSchema instead',
      );
    }
    dto.fields?.forEach(
      (f) => f.pattern && assertSafePattern(f.name, f.pattern),
    );

    Object.assign(schema, dto);

    const dtoAny = dto as any;
    if (dtoAny.fields) {
      schema.requiredFields =
        dtoAny.requiredFields ??
        dtoAny.fields
          .filter((f: SchemaFieldDto) => f.required)
          .map((f: SchemaFieldDto) => f.name);
    }

    return this.schemaRepository.save(schema);
  }

  async upgradeSchema(
    name: string,
    dto: CreateMetadataSchemaDto,
    actorId: string,
    actorRole?: string,
  ): Promise<MetadataSchema> {
    const current = await this.findLatestByName(name);
    if (!current) {
      throw new NotFoundException(
        `No existing schema found with name "${name}"`,
      );
    }
    this.assertCanModify(current, actorId, actorRole);

    const [curMajor, curMinor, curPatch] = current.version
      .split('.')
      .map(Number);
    const [newMajor, newMinor, newPatch] = dto.version.split('.').map(Number);

    const isNewer =
      newMajor > curMajor ||
      (newMajor === curMajor && newMinor > curMinor) ||
      (newMajor === curMajor && newMinor === curMinor && newPatch > curPatch);

    if (!isNewer) {
      throw new BadRequestException(
        `New version ${dto.version} must be greater than current ${current.version}`,
      );
    }

    // The new version belongs to the schema's owner, even when an admin
    // performs the upgrade on their behalf. Unowned legacy rows stay unowned
    // unless the actor creating the version is the only candidate.
    return this.create({ ...dto, name }, current.ownerId ?? actorId);
  }

  async deactivate(
    id: string,
    actorId: string,
    actorRole?: string,
  ): Promise<MetadataSchema> {
    const schema = await this.findOne(id);
    this.assertCanModify(schema, actorId, actorRole);
    schema.isActive = false;
    return this.schemaRepository.save(schema);
  }

  /**
   * Admins may manage every schema; everyone else may only modify the schema
   * they created. Rows without an owner predate ownership tracking and are
   * therefore admin-only.
   */
  private assertCanModify(
    schema: MetadataSchema,
    actorId: string,
    actorRole?: string,
  ): void {
    if (actorRole === UserRole.ADMIN) return;
    if (schema.ownerId && schema.ownerId === actorId) return;
    throw new ForbiddenException(
      'Only the schema owner or an admin can modify this schema',
    );
  }

  async getVersionHistory(name: string): Promise<MetadataSchema[]> {
    return this.schemaRepository.find({
      where: { name },
      order: { createdAt: 'DESC' },
    });
  }

  async validate(
    schemaId: string,
    metadata: Record<string, any>,
  ): Promise<MetadataValidationResultDto> {
    const schema = await this.findOne(schemaId);
    const errors = this.validateAgainstSchema(schema, metadata);

    return {
      valid: errors.length === 0,
      errors,
      schemaId: schema.id,
      schemaVersion: schema.version,
    };
  }

  validateAgainstSchema(
    schema: MetadataSchema,
    metadata: Record<string, any>,
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];

    if (!metadata || typeof metadata !== 'object') {
      errors.push({
        field: '_root',
        message: 'Metadata must be a non-null object',
        constraint: 'type',
      });
      return errors;
    }

    for (const requiredField of schema.requiredFields ?? []) {
      if (
        metadata[requiredField] === undefined ||
        metadata[requiredField] === null
      ) {
        errors.push({
          field: requiredField,
          message: `"${requiredField}" is required`,
          value: undefined,
          constraint: 'required',
        });
      }
    }

    for (const field of schema.fields) {
      const value = metadata[field.name];
      if (value === undefined || value === null) continue;
      errors.push(...this.validateField(field, value));
    }

    if (!schema.allowCustomFields) {
      const definedFields = new Set(schema.fields.map((f) => f.name));
      for (const key of Object.keys(metadata)) {
        if (!definedFields.has(key)) {
          errors.push({
            field: key,
            message: `Custom field "${key}" is not allowed by this schema`,
            value: metadata[key],
            constraint: 'noCustomFields',
          });
        }
      }
    }

    return errors;
  }

  private validateField(
    field: SchemaField,
    value: any,
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];

    switch (field.type) {
      case FieldType.STRING:
        if (typeof value !== 'string') {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a string`,
            value,
            constraint: 'type',
          });
          break;
        }
        if (field.minLength !== undefined && value.length < field.minLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at least ${field.minLength} characters`,
            value,
            constraint: 'minLength',
          });
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at most ${field.maxLength} characters`,
            value,
            constraint: 'maxLength',
          });
        }
        if (field.pattern) {
          // Patterns are validated on create/update; recompile defensively for legacy rows.
          const regex = assertSafePattern(field.name, field.pattern);
          if (!regex.test(value)) {
            errors.push({
              field: field.name,
              message: `"${field.name}" does not match required pattern`,
              value,
              constraint: 'pattern',
            });
          }
        }
        if (field.enumValues && !field.enumValues.includes(value)) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be one of: ${field.enumValues.join(', ')}`,
            value,
            constraint: 'enum',
          });
        }
        break;

      case FieldType.NUMBER:
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a number`,
            value,
            constraint: 'type',
          });
          break;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at least ${field.min}`,
            value,
            constraint: 'min',
          });
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at most ${field.max}`,
            value,
            constraint: 'max',
          });
        }
        break;

      case FieldType.BOOLEAN:
        if (typeof value !== 'boolean') {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a boolean`,
            value,
            constraint: 'type',
          });
        }
        break;

      case FieldType.DATE:
        if (isNaN(Date.parse(String(value)))) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a valid date`,
            value,
            constraint: 'type',
          });
        }
        break;

      case FieldType.EMAIL: {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof value !== 'string' || !emailPattern.test(value)) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a valid email address`,
            value,
            constraint: 'email',
          });
        }
        break;
      }

      case FieldType.URL: {
        try {
          new URL(String(value));
        } catch {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a valid URL`,
            value,
            constraint: 'url',
          });
        }
        break;
      }

      case FieldType.ENUM:
        if (!field.enumValues?.includes(String(value))) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be one of: ${field.enumValues?.join(', ')}`,
            value,
            constraint: 'enum',
          });
        }
        break;

      case FieldType.ARRAY:
        if (!Array.isArray(value)) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be an array`,
            value,
            constraint: 'type',
          });
          break;
        }
        if (field.minLength !== undefined && value.length < field.minLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must have at least ${field.minLength} items`,
            value,
            constraint: 'minLength',
          });
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must have at most ${field.maxLength} items`,
            value,
            constraint: 'maxLength',
          });
        }
        if (field.items) {
          value.forEach((item: any, index: number) => {
            const itemErrors = this.validateField(
              { ...field.items!, name: `${field.name}[${index}]` },
              item,
            );
            errors.push(...itemErrors);
          });
        }
        break;

      case FieldType.OBJECT:
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be an object`,
            value,
            constraint: 'type',
          });
          break;
        }
        if (field.properties) {
          for (const prop of field.properties) {
            const propValue = value[prop.name];
            if (
              prop.required &&
              (propValue === undefined || propValue === null)
            ) {
              errors.push({
                field: `${field.name}.${prop.name}`,
                message: `"${field.name}.${prop.name}" is required`,
                value: undefined,
                constraint: 'required',
              });
              continue;
            }
            if (propValue !== undefined && propValue !== null) {
              const propErrors = this.validateField(
                { ...prop, name: `${field.name}.${prop.name}` },
                propValue,
              );
              errors.push(...propErrors);
            }
          }
        }
        break;
    }

    return errors;
  }
}
