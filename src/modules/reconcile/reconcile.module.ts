import { Module, forwardRef } from '@nestjs/common';
import { BillService } from './bill.service';
import { ReconcileService } from './reconcile.service';
import { ChannelModule } from '../channel/channel.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [ChannelModule, forwardRef(() => PaymentModule)],
  providers: [BillService, ReconcileService],
  exports: [BillService, ReconcileService],
})
export class ReconcileModule {}
