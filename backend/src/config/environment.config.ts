import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  validateSync,
  IsOptional,
  IsBoolean,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const CERTIFICATE_EXPIRY_WINDOW_DAYS =
  process.env.CERTIFICATE_EXPIRY_WINDOW_DAYS || '0';
export const STELLAR_SEQUENCE_THRESHOLD =
  process.env.STELLAR_SEQUENCE_THRESHOLD || '';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  PORT: number;

  @IsString()
  DB_HOST: string;

  @IsNumber()
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsString()
  @ValidateIf((o) => o.NODE_ENV === 'production')
  @MinLength(32, {
    message:
      'JWT_ACCESS_SECRET must be at least 32 characters long in production environment',
  })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @ValidateIf((o) => o.NODE_ENV === 'production')
  @MinLength(32, {
    message:
      'JWT_REFRESH_SECRET must be at least 32 characters long in production environment',
  })
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  STELLAR_NETWORK: string;

  @IsString()
  STELLAR_HORIZON_URL: string;

  @IsString()
  STELLAR_ISSUER_SECRET_KEY: string;

  @IsString()
  STELLAR_ISSUER_PUBLIC_KEY: string;

  @IsString()
  ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsBoolean()
  ENABLE_SENTRY?: boolean;

  // Email Configuration
  @IsOptional()
  @IsString()
  EMAIL_SERVICE?: string;

  @IsOptional()
  @IsString()
  EMAIL_HOST?: string;

  @IsOptional()
  @IsNumber()
  EMAIL_PORT?: number;

  @IsOptional()
  @IsString()
  EMAIL_USERNAME?: string;

  @IsOptional()
  @IsString()
  EMAIL_PASSWORD?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  @IsOptional()
  @IsString()
  SENDGRID_API_KEY?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  // Storage Configuration
  @IsOptional()
  @IsString()
  STORAGE_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  STORAGE_REGION?: string;

  @IsOptional()
  @IsString()
  STORAGE_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  STORAGE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STORAGE_BUCKET?: string;

  @IsOptional()
  @IsBoolean()
  STORAGE_REQUIRED?: boolean;

  @IsOptional()
  @IsNumber()
  AUDIT_RETENTION_DAYS?: number;

  @IsOptional()
  @IsString()
  REQUEST_SIZE_LIMIT?: string;

  @IsOptional()
  @IsNumber()
  RATE_LIMIT_DEFAULT_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  RATE_LIMIT_DEFAULT_MAX_REQUESTS?: number;

  @IsOptional()
  @IsNumber()
  AUTH_BRUTE_FORCE_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  AUTH_BRUTE_FORCE_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsNumber()
  VERIFICATION_RATE_LIMIT_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  VERIFICATION_RATE_LIMIT_MAX_REQUESTS?: number;

  @IsOptional()
  @IsString()
  SECURITY_CSP?: string;

  @IsOptional()
  @IsString()
  SECURITY_FORCE_HSTS?: string;

  // Duplicate Detection Configuration
  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_THRESHOLD?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_EMAIL_WEIGHT?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_NAME_WEIGHT?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_TITLE_WEIGHT?: number;

  @IsOptional()
  @IsBoolean()
  DUPLICATE_DETECTION_FUZZY_MATCHING?: boolean;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_TIME_WINDOW_DAYS?: number;
}

export function validateEnv(
  config: Record<string, unknown> = {},
): EnvironmentVariables {
  const e = (key: string) => (config[key] as string) || process.env[key];
  const validatedEnv = plainToClass(
    EnvironmentVariables,
    {
      NODE_ENV: e('NODE_ENV') || 'development',
      PORT: e('PORT') ? parseInt(e('PORT') as string, 10) : 3000,
      DB_HOST: e('DB_HOST') || 'localhost',
      DB_PORT: e('DB_PORT') ? parseInt(e('DB_PORT') as string, 10) : 5432,
      DB_USERNAME: e('DB_USERNAME') || 'postgres',
      DB_PASSWORD: e('DB_PASSWORD') || 'password',
      DB_NAME: e('DB_NAME') || 'stellarcert',
      JWT_SECRET: e('JWT_SECRET'),
      JWT_ACCESS_SECRET: e('JWT_ACCESS_SECRET') || e('JWT_SECRET'),
      JWT_REFRESH_SECRET: e('JWT_REFRESH_SECRET') || e('JWT_SECRET'),
      JWT_EXPIRES_IN: e('JWT_EXPIRES_IN') || '24h',
      JWT_ACCESS_EXPIRES_IN: e('JWT_ACCESS_EXPIRES_IN') || '15m',
      JWT_REFRESH_EXPIRES_IN: e('JWT_REFRESH_EXPIRES_IN') || '7d',
      STELLAR_NETWORK: e('STELLAR_NETWORK') || 'testnet',
      STELLAR_HORIZON_URL:
        e('STELLAR_HORIZON_URL') || 'https://horizon-testnet.stellar.org',
      STELLAR_ISSUER_SECRET_KEY: e('STELLAR_ISSUER_SECRET_KEY') || '',
      STELLAR_ISSUER_PUBLIC_KEY: e('STELLAR_ISSUER_PUBLIC_KEY') || '',
      ALLOWED_ORIGINS: e('ALLOWED_ORIGINS') || 'http://localhost:5173',
      SENTRY_DSN: e('SENTRY_DSN'),
      ENABLE_SENTRY: e('ENABLE_SENTRY') === 'true',
      EMAIL_SERVICE: e('EMAIL_SERVICE'),
      EMAIL_HOST: e('EMAIL_HOST'),
      EMAIL_PORT: e('EMAIL_PORT')
        ? parseInt(e('EMAIL_PORT') as string, 10)
        : undefined,
      EMAIL_USERNAME: e('EMAIL_USERNAME'),
      EMAIL_PASSWORD: e('EMAIL_PASSWORD'),
      EMAIL_FROM: e('EMAIL_FROM'),
      SENDGRID_API_KEY: e('SENDGRID_API_KEY'),
      REDIS_URL: e('REDIS_URL'),
      STORAGE_ENDPOINT: e('STORAGE_ENDPOINT'),
      STORAGE_REGION: e('STORAGE_REGION'),
      STORAGE_ACCESS_KEY: e('STORAGE_ACCESS_KEY'),
      STORAGE_SECRET_KEY: e('STORAGE_SECRET_KEY'),
      STORAGE_BUCKET: e('STORAGE_BUCKET'),
      STORAGE_REQUIRED: e('STORAGE_REQUIRED') !== 'false',
      AUDIT_RETENTION_DAYS: e('AUDIT_RETENTION_DAYS')
        ? parseInt(e('AUDIT_RETENTION_DAYS') as string, 10)
        : undefined,
      REQUEST_SIZE_LIMIT: e('REQUEST_SIZE_LIMIT'),
      RATE_LIMIT_DEFAULT_WINDOW_MS: e('RATE_LIMIT_DEFAULT_WINDOW_MS')
        ? parseInt(e('RATE_LIMIT_DEFAULT_WINDOW_MS') as string, 10)
        : undefined,
      RATE_LIMIT_DEFAULT_MAX_REQUESTS: e('RATE_LIMIT_DEFAULT_MAX_REQUESTS')
        ? parseInt(e('RATE_LIMIT_DEFAULT_MAX_REQUESTS') as string, 10)
        : undefined,
      AUTH_BRUTE_FORCE_WINDOW_MS: e('AUTH_BRUTE_FORCE_WINDOW_MS')
        ? parseInt(e('AUTH_BRUTE_FORCE_WINDOW_MS') as string, 10)
        : undefined,
      AUTH_BRUTE_FORCE_MAX_ATTEMPTS: e('AUTH_BRUTE_FORCE_MAX_ATTEMPTS')
        ? parseInt(e('AUTH_BRUTE_FORCE_MAX_ATTEMPTS') as string, 10)
        : undefined,
      VERIFICATION_RATE_LIMIT_WINDOW_MS: e('VERIFICATION_RATE_LIMIT_WINDOW_MS')
        ? parseInt(e('VERIFICATION_RATE_LIMIT_WINDOW_MS') as string, 10)
        : 60 * 1000,
      VERIFICATION_RATE_LIMIT_MAX_REQUESTS: e(
        'VERIFICATION_RATE_LIMIT_MAX_REQUESTS',
      )
        ? parseInt(e('VERIFICATION_RATE_LIMIT_MAX_REQUESTS') as string, 10)
        : 100,
      SECURITY_CSP: e('SECURITY_CSP'),
      SECURITY_FORCE_HSTS: e('SECURITY_FORCE_HSTS'),
      DUPLICATE_DETECTION_THRESHOLD: e('DUPLICATE_DETECTION_THRESHOLD')
        ? parseFloat(e('DUPLICATE_DETECTION_THRESHOLD') as string)
        : undefined,
      DUPLICATE_DETECTION_EMAIL_WEIGHT: e('DUPLICATE_DETECTION_EMAIL_WEIGHT')
        ? parseFloat(e('DUPLICATE_DETECTION_EMAIL_WEIGHT') as string)
        : undefined,
      DUPLICATE_DETECTION_NAME_WEIGHT: e('DUPLICATE_DETECTION_NAME_WEIGHT')
        ? parseFloat(e('DUPLICATE_DETECTION_NAME_WEIGHT') as string)
        : undefined,
      DUPLICATE_DETECTION_TITLE_WEIGHT: e('DUPLICATE_DETECTION_TITLE_WEIGHT')
        ? parseFloat(e('DUPLICATE_DETECTION_TITLE_WEIGHT') as string)
        : undefined,
      DUPLICATE_DETECTION_FUZZY_MATCHING:
        e('DUPLICATE_DETECTION_FUZZY_MATCHING') === 'true',
      DUPLICATE_DETECTION_TIME_WINDOW_DAYS: e(
        'DUPLICATE_DETECTION_TIME_WINDOW_DAYS',
      )
        ? parseInt(e('DUPLICATE_DETECTION_TIME_WINDOW_DAYS') as string, 10)
        : undefined,
    },
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validatedEnv);

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedEnv;
}
