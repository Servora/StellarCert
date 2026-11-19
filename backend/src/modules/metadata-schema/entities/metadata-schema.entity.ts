import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FieldType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  EMAIL = 'email',
  URL = 'url',
  ENUM = 'enum',
  ARRAY = 'array',
  OBJECT = 'object',
}

export interface SchemaField {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enumValues?: string[];
  default?: any;
  items?: SchemaField;
  properties?: SchemaField[];
}

@Entity('metadata_schemas')
export class MetadataSchema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column()
  @Index()
  version: string;

  @Column({ type: 'jsonb' })
  fields: SchemaField[];

  @Column({ type: 'jsonb', nullable: true })
  requiredFields: string[] | null;

  @Column({ default: true })
  allowCustomFields: boolean;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  issuerId: string | null;

  /**
   * User who created this schema. Only the owner (or an admin) may update,
   * upgrade or deactivate it. Null for rows created before ownership was
   * tracked; those are admin-managed.
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  ownerId: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'varchar', nullable: true })
  previousVersionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
