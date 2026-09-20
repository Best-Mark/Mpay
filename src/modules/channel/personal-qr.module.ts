import { Module } from '@nestjs/common';
import { PersonalQrController } from './personal-qr.controller';
import { AdminPersonalQrController } from './admin-personal-qr.controller';
import { PersonalQrMonitorController } from './personal-qr-monitor.controller';
import { PersonalQrService } from './personal-qr.service';
import { PersonalQrMonitorService } from './personal-qr-monitor.service';
import { PaymentModule } from '../payment/payment.module';
import { AdminModule } from '../admin/admin.module';
import { MerchantModule } from '../merchant/merchant.module';
import { MailModule } from '../mail/mail.module';

import { MonitorAuthGuard } from '../auth/monitor-auth.guard';

/**
 * 个人收款码：面向没有商户号的用户
 * 上传收款码 → 收银台页展示 → 监控器上报到账 → 自动匹配置成功（匹配不上则挂账人工处理）
 * → 通知业务系统
 */
@Module({
  imports: [PaymentModule, AdminModule, MerchantModule, MailModule],
  controllers: [PersonalQrController, AdminPersonalQrController, PersonalQrMonitorController],
  providers: [PersonalQrService, PersonalQrMonitorService, MonitorAuthGuard],
  exports: [PersonalQrService, PersonalQrMonitorService],
})
export class PersonalQrModule {}
