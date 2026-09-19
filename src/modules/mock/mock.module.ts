import { Module } from '@nestjs/common';
import { MockController } from './mock.controller';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [MockController],
})
export class MockModule {}
