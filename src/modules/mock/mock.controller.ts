import { Controller, Get, Post, Param, Query, Res, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentService } from '../payment/payment.service';
import { MockAdapter } from '../channel/adapters/mock.adapter';

/**
 * 模拟渠道（仅 sandbox 模式可用）
 * 用于在本地/测试环境跑通全链路：
 *   下单 -> 收银台「确认支付」-> 回调支付中心 -> 更新订单 -> 异步通知业务系统 -> 日终对账
 * 生产环境设置 DEFAULT_CHANNEL_MODE=prod 后该模块自动关闭
 */
@ApiTags('模拟渠道')
@Controller()
export class MockController {
  private readonly logger = new Logger(MockController.name);

  constructor(private readonly paymentService: PaymentService) {}

  private assertEnabled() {
    if ((process.env.DEFAULT_CHANNEL_MODE || 'sandbox') !== 'sandbox') {
      throw new Error('模拟渠道仅在 sandbox 模式可用');
    }
  }

  @Get('mock/cashier')
  @ApiOperation({ summary: '模拟收银台页面' })
  cashier(@Query('pay_order_no') payOrderNo: string, @Res() res: Response) {
    this.assertEnabled();
    const disabled = !payOrderNo;
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模拟收银台</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f5f7fa;margin:0;padding:40px 16px}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);padding:28px}
h2{margin:0 0 4px;font-size:18px;color:#1f2d3d}
.sub{color:#8492a6;font-size:13px;margin-bottom:20px}
.field{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed #e5e9f2;font-size:14px}
.field span:first-child{color:#8492a6}
.field span:last-child{color:#1f2d3d;font-weight:600;word-break:break-all;max-width:60%;text-align:right}
.btn{display:block;width:100%;margin-top:22px;padding:14px;border:0;border-radius:8px;background:#07c160;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.btn:hover{background:#06ad56}
.btn.gray{background:#c0c4cc;cursor:not-allowed}
.tip{margin-top:14px;font-size:12px;color:#a8b3c5;text-align:center}
</style></head><body>
<div class="card">
  <h2>模拟收银台</h2>
  <div class="sub">仅用于联调自测，不产生真实资金流动</div>
  <div class="field"><span>支付订单号</span><span>${payOrderNo || '-'}</span></div>
  <div class="field"><span>渠道</span><span>MOCK</span></div>
  ${disabled
      ? '<button class="btn gray" disabled>缺少 pay_order_no 参数</button>'
      : `<button class="btn" onclick="pay('${payOrderNo}')">确认支付</button>`}
  <div class="tip">点击「确认支付」将触发渠道回调 → 支付中心更新订单 → 异步通知业务系统</div>
</div>
<script>
function pay(no){
  fetch('/api/v1/mock/pay/'+no+'/success',{method:'POST',headers:{'Content-Type':'application/json'}})
    .then(r=>r.json())
    .then(d=>{ alert(d && d.code===0 ? '支付成功，已通知业务系统' : ('支付失败：'+(d&&d.message))); })
    .catch(e=>alert('请求异常：'+e.message));
}
</script>
</body></html>`);
  }

  /** 模拟渠道侧支付成功并回调支付中心（完整走回调→状态流转→异步通知链路） */
  @Post('api/v1/mock/pay/:payOrderNo/success')
  @ApiOperation({ summary: '模拟支付成功（触发回调与通知）' })
  async paySuccess(@Param('payOrderNo') payOrderNo: string) {
    this.assertEnabled();
    const rec = MockAdapter.get(payOrderNo);
    if (!rec) return { code: 3001, message: '订单不存在或未在模拟渠道下单' };

    const marked = MockAdapter.markPaid(payOrderNo);
    await this.paymentService.markPaid(payOrderNo, {
      channelTxnId: marked?.channelTxnId,
      payerId: marked?.payerId,
      paidAmount: marked?.amount,
      paidAt: marked?.paidAt || new Date(),
      raw: { source: 'mock-cashier' },
    });
    this.logger.log(`[mock] 模拟支付成功 ${payOrderNo} ${marked?.amount}元`);
    return { code: 0, message: 'success', data: { payOrderNo, amount: marked?.amount } };
  }

  /** 对账演练：注入差异，验证对账引擎的差异识别能力 */
  @Post('api/v1/mock/diff/inject')
  @ApiOperation({ summary: '注入对账差异（MISSING_IN_CHANNEL / AMOUNT_DIFF / EXTRA_IN_CHANNEL）' })
  async injectDiff(@Query('payOrderNo') payOrderNo: string, @Query('type') type: string) {
    this.assertEnabled();
    const valid = ['MISSING_IN_CHANNEL', 'AMOUNT_DIFF', 'EXTRA_IN_CHANNEL'];
    if (!payOrderNo || !valid.includes(type)) {
      return { code: 1001, message: `type 必须是 ${valid.join(' / ')} 之一` };
    }
    MockAdapter.injectedDiffs.set(payOrderNo, type as any);
    return { code: 0, message: 'success', data: { payOrderNo, type } };
  }
}
