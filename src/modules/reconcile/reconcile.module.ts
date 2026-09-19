import { Module, forwardRef } from '@nestjs/common';
import { BillService } from './bill.service';
import { ReconcileService } from './reconcile.service';
import { ChannelModule } from '../channel/channel.module';
import { PaymentModule } from '../payment/payment.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ChannelModule, forwardRef(() => PaymentModule), MailModule],
  providers: [BillService, ReconcileService],
  exports: [BillService, ReconcileService],
})
export class ReconcileModule {}
