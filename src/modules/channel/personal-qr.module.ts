import { Module } from '@nestjs/common';
import { PersonalQrController } from './personal-qr.controller';
import { AdminPersonalQrController } from './admin-personal-qr.controller';
import { PersonalQrService } from './personal-qr.service';
import { PaymentModule } from '../payment/payment.module';
import { AdminModule } from '../admin/admin.module';

/**
 * 个人收款码：面向没有商户号的用户
 * 上传收款码 → 收银台页展示 → 付款人申报 → 后台确认到账 → 通知业务系统
 */
@Module({
  imports: [PaymentModule, AdminModule],
  controllers: [PersonalQrController, AdminPersonalQrController],
  providers: [PersonalQrService],
  exports: [PersonalQrService],
})
export class PersonalQrModule {}
