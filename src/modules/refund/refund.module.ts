import { Module, forwardRef } from '@nestjs/common';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { MerchantModule } from '../merchant/merchant.module';
import { ChannelModule } from '../channel/channel.module';
import { NotifyModule } from '../notify/notify.module';

@Module({
  imports: [MerchantModule, ChannelModule, forwardRef(() => NotifyModule)],
  providers: [RefundService],
  controllers: [RefundController],
  exports: [RefundService],
})
export class RefundModule {}
