import { Module } from '@nestjs/common';
import { PaymentConfig } from './payment.config';
import { FeishuService } from './feishu.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  controllers: [PaymentController],
  providers: [PaymentConfig, FeishuService, PaymentService],
})
export class PaymentModule {}
