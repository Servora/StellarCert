declare enum Environment {
    Development = "development",
    Production = "production",
    Test = "test"
}
declare class EnvironmentVariables {
    NODE_ENV: Environment;
    PORT: number;
    DB_HOST: string;
    DB_PORT: number;
    DB_USERNAME: string;
    DB_PASSWORD: string;
    DB_NAME: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    STELLAR_NETWORK: string;
    STELLAR_HORIZON_URL: string;
    STELLAR_ISSUER_SECRET_KEY: string;
    STELLAR_ISSUER_PUBLIC_KEY: string;
    ALLOWED_ORIGINS: string;
    SENTRY_DSN?: string;
    ENABLE_SENTRY?: boolean;
    EMAIL_SERVICE?: string;
    EMAIL_HOST?: string;
    EMAIL_PORT?: number;
    EMAIL_USERNAME?: string;
    EMAIL_PASSWORD?: string;
    EMAIL_FROM?: string;
    SENDGRID_API_KEY?: string;
    REDIS_URL?: string;
}
export declare function validateEnv(): EnvironmentVariables;
export {};
