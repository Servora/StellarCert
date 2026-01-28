import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  entities: [],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV !== 'production',
  autoLoadEntities: true,
};