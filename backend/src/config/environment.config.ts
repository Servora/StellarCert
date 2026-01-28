import { plainToClass } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync, IsOptional, IsBoolean } from 'class-validator';

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

  @IsString()
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string;

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
}

export function validateEnv(config: Record<string, any>): EnvironmentVariables {
  const validatedEnv = plainToClass(
    EnvironmentVariables,
    {
      NODE_ENV: config.NODE_ENV,
      PORT: config.PORT,
      DB_HOST: config.DB_HOST,
      DB_PORT: config.DB_PORT,
      DB_USERNAME: config.DB_USERNAME,
      DB_PASSWORD: config.DB_PASSWORD,
      DB_NAME: config.DB_NAME,
      JWT_SECRET: config.JWT_SECRET,
      JWT_EXPIRES_IN: config.JWT_EXPIRES_IN,
      STELLAR_NETWORK: config.STELLAR_NETWORK,
      STELLAR_HORIZON_URL: config.STELLAR_HORIZON_URL,
      STELLAR_ISSUER_SECRET_KEY: config.STELLAR_ISSUER_SECRET_KEY,
      STELLAR_ISSUER_PUBLIC_KEY: config.STELLAR_ISSUER_PUBLIC_KEY,
      ALLOWED_ORIGINS: config.ALLOWED_ORIGINS,
      SENTRY_DSN: config.SENTRY_DSN,
      ENABLE_SENTRY: config.ENABLE_SENTRY === 'true',
      EMAIL_SERVICE: config.EMAIL_SERVICE,
      EMAIL_HOST: config.EMAIL_HOST,
      EMAIL_PORT: config.EMAIL_PORT,
      EMAIL_USERNAME: config.EMAIL_USERNAME,
      EMAIL_PASSWORD: config.EMAIL_PASSWORD,
      EMAIL_FROM: config.EMAIL_FROM,
      SENDGRID_API_KEY: config.SENDGRID_API_KEY,
      REDIS_URL: config.REDIS_URL,
      STORAGE_ENDPOINT: config.STORAGE_ENDPOINT,
      STORAGE_REGION: config.STORAGE_REGION,
      STORAGE_ACCESS_KEY: config.STORAGE_ACCESS_KEY,
      STORAGE_SECRET_KEY: config.STORAGE_SECRET_KEY,
      STORAGE_BUCKET: config.STORAGE_BUCKET,
    },
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validatedEnv);

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedEnv;
}