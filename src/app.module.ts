import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { ChannelModule } from './modules/channel/channel.module';
import { PaymentModule } from './modules/payment/payment.module';
import { RefundModule } from './modules/refund/refund.module';
import { NotifyModule } from './modules/notify/notify.module';
import { ReconcileModule } from './modules/reconcile/reconcile.module';
import { AdminModule } from './modules/admin/admin.module';
import { InstallModule } from './modules/install/install.module';
import { MockModule } from './modules/mock/mock.module';
import { MailModule } from './modules/mail/mail.module';
import { PortalModule } from './modules/portal/portal.module';
import { UploadModule } from './modules/upload/upload.module';
import { PersonalQrModule } from './modules/channel/personal-qr.module';
import { AllExceptionFilter } from './common/filters/all-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    ScheduleModule.forRoot(),
    CommonModule,
    MerchantModule,
    ChannelModule,
    PaymentModule,
    RefundModule,
    NotifyModule,
    ReconcileModule,
    AdminModule,
    InstallModule,
    MockModule,
    MailModule,
    PortalModule,
    UploadModule,
    PersonalQrModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
  ],
})
export class AppModule {}
