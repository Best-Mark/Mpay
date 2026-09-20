import { Body, Controller, Get, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PersonalQrService } from './personal-qr.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel, PayOrderStatus } from '../../common/constants/enums';

const esc = (v: any) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 个人收款码：收银台页 + 到账申报
 *
 * 链路：业务系统下单(personal_qr) → payInfo.url 指向本页 → 付款人扫码付款
 *      → 点「我已支付」（仅申报，不改订单状态）→ 收款方后台核对账单后「确认到账」
 *      → 订单 SUCCESS + 异步通知业务系统（与其它渠道完全一致的回调）
 */
@ApiTags('个人收款码')
@Controller()
export class PersonalQrController {
  private readonly logger = new Logger(PersonalQrController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly qrService: PersonalQrService,
  ) {}

  /** 收银台页：展示收款码 + 金额 + 状态，供付款人扫码付款 */
  @Get('qr/cashier')
  @ApiOperation({ summary: '个人收款码收银台页' })
  async cashier(@Query('pay_order_no') payOrderNo: string, @Res() res: Response) {
    if (!payOrderNo) {
      return res
        .set('Content-Type', 'text/html; charset=utf-8')
        .status(400)
        .send('<meta name="viewport" content="width=device-width,initial-scale=1"><p style="font:14px/2 system-ui;padding:24px">缺少 pay_order_no 参数</p>');
    }

    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order || order.channel !== Channel.PERSONAL_QR) {
      return res
        .set('Content-Type', 'text/html; charset=utf-8')
        .status(404)
        .send('<meta name="viewport" content="width=device-width,initial-scale=1"><p style="font:14px/2 system-ui;padding:24px">订单不存在或非个人收款码订单</p>');
    }

    const codes = await this.qrService.pickAll(order.appId);
    // 开启「唯一金额识别码」后，应付金额 = 订单金额 + 分位识别码（见 adapter.createPayment）
    const amount = ((order.payParams as any)?.qrAmount || Number(order.amount).toFixed(2)) as string;
    const remark = payOrderNo.slice(-6);
    const status = order.status;
    const claimed = !!(order.extra as any)?.claim;
    const paid = status === PayOrderStatus.SUCCESS;
    const closed = [PayOrderStatus.CLOSED, PayOrderStatus.REVOKED].includes(status as PayOrderStatus);

    const tabs = codes
      .map(
        (c, i) =>
          `<button class="tab${i === 0 ? ' on' : ''}" onclick="switchTab(${i})">${esc(c.type === 'wechat' ? '微信' : c.type === 'alipay' ? '支付宝' : c.name)}</button>`,
      )
      .join('');
    const panes = codes
      .map(
        (c, i) =>
          `<div class="pane${i === 0 ? ' on' : ''}" id="pane${i}"><img src="${esc(c.imageUrl)}" alt="收款码"><div class="name">${esc(c.name)}</div></div>`,
      )
      .join('');

    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>扫码付款</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px 14px;color:#1f2d3d}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:24px}
.amt{font-size:34px;font-weight:700;text-align:center;color:#f56c6c}
.amt i{font-size:18px;font-style:normal;margin-right:2px}
.subj{text-align:center;color:#5a6b82;font-size:14px;margin:6px 0 16px}
.tabs{display:flex;gap:8px;margin-bottom:14px}
.tab{flex:1;padding:9px 0;border:1px solid #dfe4ec;background:#fff;border-radius:8px;font-size:14px;color:#5a6b82;cursor:pointer}
.tab.on{border-color:#07c160;color:#07c160;font-weight:600}
.pane{display:none;text-align:center}
.pane.on{display:block}
.pane img{width:220px;height:220px;object-fit:contain;border:1px solid #eef1f6;border-radius:10px}
.pane .name{font-size:12px;color:#8492a6;margin-top:6px}
.warn{background:#fff7e6;border:1px solid #ffe0a3;color:#8a5a00;font-size:12.5px;line-height:1.7;padding:10px 12px;border-radius:8px;margin:14px 0}
.field{display:flex;justify-content:space-between;font-size:13px;padding:7px 0;border-bottom:1px dashed #eef1f6}
.field span:first-child{color:#8492a6}
.btn{display:block;width:100%;margin-top:16px;padding:14px;border:0;border-radius:10px;background:#07c160;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.btn.gray{background:#c0c4cc;cursor:not-allowed}
.btn.ghost{background:#fff;color:#5a6b82;border:1px solid #dfe4ec;margin-top:10px}
.state{text-align:center;font-size:14px;padding:12px;border-radius:8px;margin:12px 0}
.state.ok{background:#eafaf0;color:#0a7a42}
.state.wait{background:#f2f6fc;color:#40536e}
.state.bad{background:#fdeeee;color:#a33}
input{width:100%;padding:11px;border:1px solid #dfe4ec;border-radius:8px;font-size:14px;margin-top:8px}
.tip{text-align:center;font-size:12px;color:#a8b3c5;margin-top:12px;line-height:1.7}
</style></head><body>
<div class="card">
  <div class="amt"><i>¥</i>${esc(amount)}</div>
  <div class="subj">${esc(order.subject)}</div>
  ${paid ? '<div class="state ok">✅ 已到账，正在通知商户</div>' : ''}
  ${closed ? '<div class="state bad">订单已关闭</div>' : ''}
  ${!paid && !closed ? `<div class="state wait" id="state">${claimed ? '已收到您的付款申报，等待收款方确认到账…' : '请扫码付款'}</div>` : ''}
  ${!paid && !closed ? `<div class="tabs">${tabs}</div>${panes}` : ''}
  ${!paid && !closed ? `<div class="warn">请用上方收款码付款 <b>¥${esc(amount)}</b>，付款备注填 <b>${esc(remark)}</b>（便于收款方核对）。<br>付款完成后点下方按钮申报，收款方确认后订单即生效。</div>` : ''}
  ${!paid && !closed ? `<input id="acct" placeholder="选填：付款账号尾号 / 交易单号后 6 位">
  <button class="btn${claimed ? ' gray' : ''}" id="btn" ${claimed ? 'disabled' : ''} onclick="mark()">${claimed ? '已申报，等待确认' : '我已完成支付'}</button>` : ''}
  <div class="field"><span>订单号</span><span>${esc(payOrderNo)}</span></div>
  <div class="tip">本页由支付中心提供 · 资金直接进入收款方账户</div>
</div>
<script>
var no = '${esc(payOrderNo)}';
function switchTab(i){
  document.querySelectorAll('.tab').forEach(function(t,k){t.classList.toggle('on',k===i)});
  document.querySelectorAll('.pane').forEach(function(p,k){p.classList.toggle('on',k===i)});
}
function mark(){
  var btn=document.getElementById('btn'); btn.disabled=true; btn.className='btn gray'; btn.textContent='提交中…';
  fetch('/api/v1/qr/pay/'+no+'/mark',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({payerAccount:(document.getElementById('acct').value||'').trim()})})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d&&d.code===0){btn.textContent='已申报，等待确认';
        var s=document.getElementById('state'); if(s) s.textContent='已收到您的付款申报，等待收款方确认到账…';}
      else{btn.disabled=false;btn.className='btn';btn.textContent='我已完成支付';alert('提交失败：'+((d&&d.message)||'网络异常'));}
    })
    .catch(function(e){btn.disabled=false;btn.className='btn';btn.textContent='我已完成支付';alert('请求异常：'+e.message)});
}
function poll(){
  fetch('/api/v1/qr/pay/'+no+'/status').then(function(r){return r.json()}).then(function(d){
    if(d&&d.data&&d.data.status==='SUCCESS') location.reload();
    if(d&&d.data&&(d.data.status==='CLOSED'||d.data.status==='REVOKED')) location.reload();
  }).catch(function(){});
}
setInterval(poll,3000);
</script>
</body></html>`);
  }

  /** 轮询订单状态（收银台页用） */
  @Get('api/v1/qr/pay/:payOrderNo/status')
  @ApiOperation({ summary: '查询个人收款码订单状态（收银台页轮询）' })
  async status(@Param('payOrderNo') payOrderNo: string) {
    const order = await this.prisma.payOrder.findUnique({
      where: { payOrderNo },
      select: { payOrderNo: true, status: true, channel: true },
    });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    return { code: 0, message: 'success', data: { status: order.status, channel: order.channel } };
  }

  /**
   * 付款人申报「我已支付」
   * 注意：只做申报记录，不置订单为成功 —— 是否到账以收款方后台确认（或人工核对账单）为准
   */
  @Post('api/v1/qr/pay/:payOrderNo/mark')
  @ApiOperation({ summary: '付款人申报已支付（仅供收款方核对，不直接置成功）' })
  async mark(@Param('payOrderNo') payOrderNo: string, @Body() body: { payerAccount?: string; remark?: string }) {
    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    if (order.channel !== Channel.PERSONAL_QR) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该订单不是个人收款码订单');
    }
    if (order.status === PayOrderStatus.SUCCESS) return { code: 0, message: '订单已支付成功' };
    if ([PayOrderStatus.CLOSED, PayOrderStatus.REVOKED].includes(order.status as PayOrderStatus)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单已关闭，无法申报');
    }

    const extra = { ...(order.extra as any), claim: { at: new Date().toISOString(), payerAccount: body?.payerAccount || '', remark: body?.remark || '' } };
    await this.prisma.payOrder.update({
      where: { payOrderNo },
      data: { status: PayOrderStatus.PAYING, extra, payerId: body?.payerAccount || undefined },
    });
    this.logger.log(`[personal-qr] 付款人申报 ${payOrderNo} account=${body?.payerAccount || '-'}`);
    return { code: 0, message: '已申报，等待收款方确认到账' };
  }
}
