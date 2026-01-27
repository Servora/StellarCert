"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const bull_1 = require("@nestjs/bull");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const certificates_module_1 = require("./modules/certificates/certificates.module");
const issuers_module_1 = require("./modules/issuers/issuers.module");
const health_module_1 = require("./modules/health/health.module");
const common_module_1 = require("./common/common.module");
const email_module_1 = require("./modules/email/email.module");
const typeorm_config_1 = require("./config/typeorm.config");
const environment_config_1 = require("./config/environment.config");
const certificate_module_1 = require("./certificate/certificate.module");
const stellar_module_1 = require("./modules/stellar/stellar.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                validate: environment_config_1.validateEnv,
            }),
            bull_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (configService) => {
                    const redisUrl = configService.get('REDIS_URL');
                    if (redisUrl) {
                        return { redis: { url: redisUrl } };
                    }
                    return {
                        redis: {
                            host: 'localhost',
                            port: 6379,
                        },
                    };
                },
            }),
            typeorm_1.TypeOrmModule.forRoot(typeorm_config_1.typeOrmConfig),
            common_module_1.CommonModule,
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            certificates_module_1.CertificatesModule,
            issuers_module_1.IssuersModule,
            certificate_module_1.CertificateModule,
            stellar_module_1.StellarModule,
            email_module_1.EmailModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map