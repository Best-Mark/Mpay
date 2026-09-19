import { Module } from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { MerchantAuthGuard } from './merchant-auth.guard';
import { MailModule } from '../mail/mail.module';
import { MerchantModule } from '../merchant/merchant.module';

@Module({
  imports: [MailModule, MerchantModule],
  providers: [PortalService, MerchantAuthGuard],
  controllers: [PortalController],
  exports: [PortalService],
})
export class PortalModule {}
