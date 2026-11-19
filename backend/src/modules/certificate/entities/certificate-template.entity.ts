import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type TemplateOrientation = 'landscape' | 'portrait';

export type TemplateFieldAlign = 'left' | 'center' | 'right';

/** Named slots a template may position on the rendered PDF. */
export const TEMPLATE_FIELD_NAMES = [
  'title',
  'certifyText',
  'recipientName',
  'courseName',
  'issuerName',
  'issueDate',
  'expiryDate',
  'certificateId',
  'signatureLabel',
] as const;

export type TemplateFieldName = (typeof TEMPLATE_FIELD_NAMES)[number];

export interface TemplateFieldPlacement {
  x: number;
  y: number;
  fontSize?: number;
  align?: TemplateFieldAlign;
}

export interface TemplateAssetPlacement {
  x: number;
  y: number;
  width: number;
}

export interface TemplateLayout {
  logo?: TemplateAssetPlacement;
  signature?: TemplateAssetPlacement;
  qrCode?: TemplateAssetPlacement;
  fields?: Partial<Record<TemplateFieldName, TemplateFieldPlacement>>;
}

@Entity('certificate_templates')
export class CertificateTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Owning issuer (user id). NULL means a system-wide template. */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  issuerId: string | null;

  @Column({ default: true })
  isActive: boolean;

  /** At most one active default template per issuer scope. */
  @Column({ default: false })
  isDefault: boolean;

  /** Overrides the certificate heading, e.g. "Certificate of Achievement". */
  @Column({ nullable: true })
  titleText?: string;

  @Column({ default: '#1a365d' })
  primaryColor: string;

  @Column({ default: '#b08d2e' })
  accentColor: string;

  /** Base64 data URL of the issuer logo rendered on the certificate. */
  @Column({ type: 'text', nullable: true })
  logoImage?: string;

  /** Base64 data URL of the issuer signature image. */
  @Column({ type: 'text', nullable: true })
  signatureImage?: string;

  @Column({ type: 'varchar', default: 'landscape' })
  orientation: TemplateOrientation;

  /** Optional per-field placement overrides; unpositioned fields get defaults. */
  @Column({ type: 'jsonb', nullable: true })
  layout?: TemplateLayout;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
