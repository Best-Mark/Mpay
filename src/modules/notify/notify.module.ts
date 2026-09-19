import { Module, forwardRef } from '@nestjs/common';
import { NotifyService } from './notify.service';
import { NotifyController } from './notify.controller';
import { MerchantModule } from '../merchant/merchant.module';
import { ChannelModule } from '../channel/channel.module';
import { PaymentModule } from '../payment/payment.module';
import { RefundModule } from '../refund/refund.module';

@Module({
  imports: [
    MerchantModule,
    ChannelModule,
    forwardRef(() => PaymentModule),
    forwardRef(() => RefundModule),
  ],
  providers: [NotifyService],
  controllers: [NotifyController],
  exports: [NotifyService],
})
export class NotifyModule {}
