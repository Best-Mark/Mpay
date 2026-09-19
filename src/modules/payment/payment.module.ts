import { Module, forwardRef } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MerchantModule } from '../merchant/merchant.module';
import { ChannelModule } from '../channel/channel.module';
import { NotifyModule } from '../notify/notify.module';

@Module({
  imports: [MerchantModule, ChannelModule, forwardRef(() => NotifyModule)],
  providers: [PaymentService],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}
