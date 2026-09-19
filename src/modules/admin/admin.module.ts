import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminOrderController } from './admin-order.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminReconcileController } from './admin-reconcile.controller';
import { AdminSystemController } from './admin-system.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminPortalController } from './admin-portal.controller';
import { MailModule } from '../mail/mail.module';
import { PortalModule } from '../portal/portal.module';
import { MerchantModule } from '../merchant/merchant.module';
import { ChannelModule } from '../channel/channel.module';
import { PaymentModule } from '../payment/payment.module';
import { RefundModule } from '../refund/refund.module';
import { NotifyModule } from '../notify/notify.module';
import { ReconcileModule } from '../reconcile/reconcile.module';

@Module({
  imports: [
    MerchantModule,
    ChannelModule,
    PaymentModule,
    RefundModule,
    NotifyModule,
    ReconcileModule,
    MailModule,
    PortalModule,
  ],
  providers: [AdminAuthService],
  controllers: [
    AdminAuthController,
    AdminOrderController,
    AdminConfigController,
    AdminReconcileController,
    AdminSystemController,
    AdminSettingsController,
    AdminPortalController,
  ],
  exports: [AdminAuthService],
})
export class AdminModule {}
