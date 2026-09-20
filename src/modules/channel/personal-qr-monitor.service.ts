import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SystemConfigService } from '../../common/config/system-config.service';
import { PaymentService } from '../payment/payment.service';
import { MailService } from '../mail/mail.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel, PayOrderStatus } from '../../common/constants/enums';
import { Money } from '../../common/utils/money';

/** 可被「入站到账事件」置成功的订单状态 */
const PAYABLE_STATUS: string[] = [PayOrderStatus.CREATED, PayOrderStatus.PAYING];

/** 监控器上报的一笔到账 */
export interface IncomingEventInput {
  /** 到账账户类型: wechat / alipay / other */
  accountType?: string;
  /** 实收金额（元） */
  amount: string | number;
  /** 监控器侧唯一流水号（幂等键：同 appId 下重复上报只处理一次） */
  serial: string;
  /** 付款备注（收银台提示付款人填的订单号尾号） */
  remark?: string;
  /** 付款方账号 / 昵称 */
  payerAccount?: string;
  /** 到账时间（ISO 字符串，缺省为上报时间） */
  paidAt?: string;
  /** 监控器原始报文 */
  raw?: any;
}

/** 通知 / 短信原文上报（端侧无需解析，由支付中心解析） */
export interface RawTextInput {
  /** 通知或短信原文，如「微信支付收款到账 100.01 元（来自*三）」 */
  text: string;
  /** 账户类型，不传则按文本自动识别 wechat / alipay / bank */
  accountType?: string;
  /** 幂等流水号，不传则用原文哈希（同一条通知重复转发只处理一次） */
  serial?: string;
  /** 到账时间，不传则取文本中解析到的时间，再没有则取上报时间 */
  paidAt?: string;
  /** 人工补充的备注（付款人填的订单号尾号） */
  remark?: string;
  payerAccount?: string;
  raw?: any;
}

/**
 * 个人收款码「到账监控」服务
 *
 * 背景：个人收款码没有渠道回调（钱直接进收款方微信/支付宝账户，渠道无从通知支付中心）。
 * 所以实时到账状态只能来自「监控器」——一个监听收款通知的端侧/网关程序：
 *
 *   微信/支付宝收款通知 → 监控器解析（金额/备注/时间）→ 上报本服务 → 自动匹配订单 → 置成功 + 通知业务系统
 *
 * 匹配策略（由强到弱）：
 *  1) 备注尾号：付款人按收银台提示填订单号后 6 位 → 精确命中
 *  2) 唯一金额：开启 personalQr.uniqueAmount 后每单应付金额带「分位识别码」→ 金额即唯一键
 *  3) 金额 + 时间窗：同额多单时若只有一笔「已申报」则取它，否则判 AMBIGUOUS 挂账
 *
 * 匹配不上绝不猜：一律挂账（UNMATCHED / AMBIGUOUS）并发告警邮件，后台人工绑定确认。
 * 宁可慢一拍人工处理，也不能把 A 的钱记到 B 的订单上。
 */
@Injectable()
export class PersonalQrMonitorService {
  private readonly logger = new Logger(PersonalQrMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: SystemConfigService,
    private readonly paymentService: PaymentService,
    private readonly mail: MailService,
  ) {}

  // ==================== 上报入口 ====================

  /** 单笔上报：写事件 + 立即匹配结算 */
  async report(appId: string, input: IncomingEventInput) {
    const amount = Number(input.amount);
    const serial = String(input.serial || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'amount 必须是大于 0 的数字');
    }
    if (!serial) throw new BizException(ErrorCode.PARAM_ERROR, 'serial 必填（监控器侧流水号，用于幂等）');

    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BizException(ErrorCode.PARAM_ERROR, 'paidAt 不是合法时间');

    // 幂等：同一业务系统 + 同一流水号只处理一次（监控器重推/网络重试都安全）
    const exist = await this.prisma.paymentIncomingEvent.findUnique({
      where: { uk_event_app_serial: { appId, serial } },
    });
    if (exist) {
      this.logger.log(`[personal-qr] 重复上报忽略 appId=${appId} serial=${serial}`);
      return { duplicate: true, event: this.toView(exist) };
    }

    const event = await this.prisma.paymentIncomingEvent.create({
      data: {
        appId,
        accountType: (input.accountType || 'other').slice(0, 16),
        amount: Money.round(amount, 2),
        serial: serial.slice(0, 64),
        remark: input.remark ? String(input.remark).slice(0, 64) : null,
        payerAccount: input.payerAccount ? String(input.payerAccount).slice(0, 64) : null,
        paidAt,
        raw: input.raw ?? undefined,
      },
    });

    return this.settle(event);
  }

  /** 批量上报：监控器补推历史通知时用，逐条幂等 */
  async reportBatch(appId: string, list: IncomingEventInput[]) {
    if (!Array.isArray(list) || !list.length) throw new BizException(ErrorCode.PARAM_ERROR, 'events 不能为空');
    const results = [];
    for (const item of list.slice(0, 200)) {
      try {
        results.push({ ok: true, data: await this.report(appId, item) });
      } catch (e: any) {
        results.push({ ok: false, serial: item?.serial, message: e?.message || '上报失败' });
      }
    }
    return {
      total: results.length,
      matched: results.filter((r) => r.ok && (r.data as any)?.event?.matchStatus === 'MATCHED').length,
      pending: results.filter((r) => r.ok && ['UNMATCHED', 'AMBIGUOUS', 'PENDING'].includes((r.data as any)?.event?.matchStatus)).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /**
   * 通知/短信原文上报：给「零开发」监控方案用
   *
   * 场景：在收款手机上装一个通知转发工具（Tasker / MacroDroid / 短信转发器等），
   * 把微信「收款助手」/支付宝/银行的到账通知原文直接 POST 上来，由支付中心解析并结算。
   * 端侧只做一件事：把文本转发到这个接口，不用写解析逻辑。
   *
   * @param dryRun true = 只解析不落库（配置转发规则时先验证能否解析对）
   */
  async reportText(appId: string, input: RawTextInput, dryRun = false) {
    const text = String(input?.text || '').trim();
    if (!text) throw new BizException(ErrorCode.PARAM_ERROR, 'text 必填（通知 / 短信原文）');
    if (text.length > 1000) throw new BizException(ErrorCode.PARAM_ERROR, 'text 过长（最多 1000 字）');

    const customRegex = await this.cfg.getString('personalQr.textAmountRegex', '');
    const parsed = parseIncomingText(text, customRegex || undefined);
    if (dryRun) return { dryRun: true, parsed };

    // 未显式给 serial 时用原文哈希做幂等键：同一条通知被重复转发只处理一次
    const serial =
      String(input.serial || '').trim() ||
      createHash('sha1').update(text).digest('hex').slice(0, 40);

    const paidAt = input.paidAt ? new Date(input.paidAt) : parsed.paidAt;
    if (paidAt && Number.isNaN(paidAt.getTime())) throw new BizException(ErrorCode.PARAM_ERROR, 'paidAt 不是合法时间');

    const res = await this.report(appId, {
      amount: parsed.amount,
      serial,
      accountType: input.accountType || parsed.accountType,
      payerAccount: input.payerAccount || parsed.payerAccount,
      paidAt: paidAt?.toISOString(),
      remark: input.remark,
      raw: { ...(input.raw || {}), source: 'notify-text', text, matchedHint: parsed.hint },
    });
    return { ...res, parsed };
  }

  // ==================== 匹配引擎 ====================

  /** 按「备注尾号 → 金额(+时间窗)」自动匹配，唯一命中即置成功 */
  private async settle(event: any) {
    const autoConfirm = await this.cfg.getBool('personalQr.autoConfirm', true);
    if (!autoConfirm) {
      const e = await this.prisma.paymentIncomingEvent.update({
        where: { id: event.id },
        data: { matchStatus: 'PENDING' },
      });
      return { duplicate: false, event: this.toView(e), autoConfirm: false };
    }

    const windowMin = await this.cfg.getNumber('personalQr.matchWindowMinutes', 30);
    const from = new Date(event.paidAt.getTime() - windowMin * 60_000);
    const to = new Date(event.paidAt.getTime() + 5 * 60_000); // 容忍监控器与服务端时钟差

    const candidates = await this.prisma.payOrder.findMany({
      where: {
        appId: event.appId,
        channel: Channel.PERSONAL_QR,
        status: { in: PAYABLE_STATUS },
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    const hit = this.pickOrder(candidates, event);

    if (!hit.order) {
      const e = await this.prisma.paymentIncomingEvent.update({
        where: { id: event.id },
        data: { matchStatus: hit.status },
      });
      this.logger.warn(`[personal-qr] 到账事件无法匹配(${hit.status}) appId=${event.appId} serial=${event.serial} 金额=${event.amount} 候选=${candidates.length}`);
      this.alertUnmatched(e, candidates.length).catch((err) => this.logger.warn(`挂账告警发送失败: ${err.message}`));
      return { duplicate: false, event: this.toView(e), autoConfirm: true };
    }

    const res = await this.paymentService.markPaid(hit.order.payOrderNo, {
      channelTxnId: event.serial,
      payerId: event.payerAccount || hit.order.payerId || undefined,
      paidAmount: Money.format(event.amount),
      paidAt: event.paidAt,
      raw: {
        source: 'monitor',
        eventId: Number(event.id),
        accountType: event.accountType,
        remark: event.remark,
        matchedBy: hit.matchedBy,
      },
    });

    const e = await this.prisma.paymentIncomingEvent.update({
      where: { id: event.id },
      data: { matchStatus: 'MATCHED', payOrderNo: hit.order.payOrderNo },
    });

    this.logger.log(
      `[personal-qr] 自动确认到账 ${hit.order.payOrderNo} 金额=${Money.format(event.amount)} by=${hit.matchedBy} serial=${event.serial} updated=${res.updated}`,
    );
    return { duplicate: false, event: this.toView(e), autoConfirm: true, payOrderNo: hit.order.payOrderNo, updated: res.updated };
  }

  /**
   * 从候选订单里挑出唯一应匹配的那一笔
   * @returns order + matchedBy（命中依据）或 status（挂账原因）
   */
  private pickOrder(candidates: any[], event: any): { order?: any; matchedBy?: string; status?: string } {
    if (!candidates.length) return { status: 'UNMATCHED' };

    const cents = (v: any) => Math.round(Number(v) * 100);
    const eventCents = cents(event.amount);
    /** 订单应付金额：开启「唯一金额识别码」时为 payParams.qrAmount，否则就是订单金额 */
    const payable = (o: any) => o.payParams?.qrAmount ?? o.amount;

    // 1) 备注尾号：付款人填的订单号后 6 位
    const digits = String(event.remark || '').replace(/\D/g, '');
    if (digits.length >= 4) {
      const byRemark = candidates.filter((o) => digits.includes(String(o.payOrderNo).slice(-6)));
      if (byRemark.length === 1) return { order: byRemark[0], matchedBy: 'remark' };
      if (byRemark.length > 1) {
        const byAmount = byRemark.filter((o) => cents(payable(o)) === eventCents);
        if (byAmount.length === 1) return { order: byAmount[0], matchedBy: 'remark+amount' };
        if (byAmount.length > 1) return this.pickAmongSameAmount(byAmount, 'remark+amount');
      }
    }

    // 2) 金额（+ 时间窗）
    const byAmount = candidates.filter((o) => cents(payable(o)) === eventCents);
    if (byAmount.length === 1) return { order: byAmount[0], matchedBy: 'amount' };
    if (byAmount.length > 1) return this.pickAmongSameAmount(byAmount, 'amount');
    return { status: 'UNMATCHED' };
  }

  /** 同额多单：只有在一笔「已申报」时才敢自动认领，否则挂账 */
  private pickAmongSameAmount(list: any[], base: string) {
    const claimed = list.filter((o) => (o.extra as any)?.claim);
    if (claimed.length === 1) return { order: claimed[0], matchedBy: `${base}+claim` };
    return { status: 'AMBIGUOUS' };
  }

  private async alertUnmatched(event: any, candidateCount: number) {
    if (!(await this.cfg.getBool('alert.personalQrUnmatched', true))) return;
    await this.mail.alert(
      `[支付中心告警] 个人码到账未匹配 ${Money.format(event.amount)}元 appId=${event.appId}`,
      [
        `AppId：${event.appId}`,
        `流水号：${event.serial}`,
        `到账金额：${Money.format(event.amount)} 元`,
        `到账时间：${event.paidAt?.toISOString?.() || '-'}`,
        `账户类型：${event.accountType}`,
        `付款备注：${event.remark || '-'}`,
        `付款账号：${event.payerAccount || '-'}`,
        `候选订单数：${candidateCount}`,
        `匹配结果：${event.matchStatus}`,
        '',
        '处理：后台「个人收款码 → 到账事件」找到该流水号，人工绑定到订单即可补发通知。',
      ].join('\n'),
      `personal-qr-unmatched:${event.appId}`,
    );
  }

  // ==================== 后台人工处理 ====================

  /** 挂账清单：默认只看待处理的（UNMATCHED / AMBIGUOUS / PENDING） */
  async list(params: { appId?: string; status?: string; limit?: number } = {}) {
    const where: any = {};
    if (params.appId) where.appId = params.appId;
    if (params.status) {
      where.matchStatus = params.status;
    } else {
      where.matchStatus = { in: ['UNMATCHED', 'AMBIGUOUS', 'PENDING'] };
    }
    const rows = await this.prisma.paymentIncomingEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(params.limit) || 50, 1), 200),
    });
    return rows.map((r) => this.toView(r));
  }

  /** 人工绑定：把挂账事件绑到指定订单并确认到账（补发通知） */
  async bind(eventId: number, payOrderNo: string, operator = 'SYSTEM') {
    const event = await this.prisma.paymentIncomingEvent.findUnique({ where: { id: BigInt(eventId) } });
    if (!event) throw new BizException(ErrorCode.PARAM_ERROR, '到账事件不存在');
    if (['MATCHED', 'BOUND'].includes(event.matchStatus)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '该到账事件已处理，无需重复绑定');
    }

    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    if (order.appId !== event.appId) throw new BizException(ErrorCode.PARAM_ERROR, '订单不属于该业务系统，禁止跨商户绑定');
    if (order.channel !== Channel.PERSONAL_QR) {
      throw new BizException(ErrorCode.PARAM_ERROR, `订单渠道为 ${order.channel}，不能绑定个人码到账事件`);
    }
    if (!PAYABLE_STATUS.includes(order.status)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, `订单状态为 ${order.status}，无法确认到账`);
    }

    const res = await this.paymentService.markPaid(payOrderNo, {
      channelTxnId: event.serial,
      payerId: event.payerAccount || order.payerId || undefined,
      paidAmount: Money.format(event.amount),
      paidAt: event.paidAt,
      raw: { source: 'monitor-manual-bind', eventId, operator },
    });

    await this.prisma.paymentIncomingEvent.update({
      where: { id: event.id },
      data: {
        matchStatus: 'BOUND',
        payOrderNo,
        raw: { ...(event.raw as any), bind: { operator, at: new Date().toISOString(), payOrderNo } },
      },
    });

    this.logger.log(`[personal-qr] 人工绑定到账事件 #${eventId} → ${payOrderNo} by=${operator}`);
    return { eventId, payOrderNo, updated: res.updated };
  }

  private toView(r: any) {
    return {
      id: Number(r.id),
      appId: r.appId,
      accountType: r.accountType,
      amount: Money.format(r.amount),
      serial: r.serial,
      remark: r.remark,
      payerAccount: r.payerAccount,
      paidAt: r.paidAt,
      matchStatus: r.matchStatus,
      payOrderNo: r.payOrderNo,
      raw: r.raw,
      createdAt: r.createdAt,
    };
  }
}

/** 收款语义词：命中才认为这是一笔「收进来的钱」 */
const INCOME_HINTS = ['收款', '到账', '入账', '收入', '收到', '已收', '转入', '进账'];
/** 支出语义词：出现支出词且无收款词时直接拒绝 —— 防止把「付款 100 元」的通知记成到账 */
const OUTCOME_HINTS = ['付款', '支出', '消费', '扣款', '已支付', '支付成功', '快币', '还款'];

/** 金额抽取（由强到弱）：先「收款/到账 + 金额」，再「人民币 + 金额」，最后裸金额 */
const AMOUNT_PATTERNS: RegExp[] = [
  /(?:收款|到账|入账|收入|收到|进账)[^\d]{0,10}(?:人民币|RMB|CNY|¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*元/,
  /(?:人民币|RMB|CNY|¥|￥)\s*(\d+(?:\.\d{1,2})?)\s*元/,
  /(\d+(?:\.\d{1,2})?)\s*元/,
];

const PAYER_PATTERNS: RegExp[] = [
  /(?:来自|付款方|付款人|付款账号|from)\s*[:：]?\s*([^\s，,。;；（(（)）【】\[\]]{1,20})/,
];

/**
 * 解析到账通知 / 短信原文
 *
 * 关键防线：微信/支付宝的通知有「收款」和「付款」两种，长得很像。
 * 把付款通知当成收款 = 凭空造一笔收入（资损），所以只认收款语义，
 * 纯支出语义一律拒绝并给出明确错误信息。
 *
 * @param customAmountRegex 可选：后台配置 personalQr.textAmountRegex 覆盖金额抽取（第一个捕获组为金额）
 */
export function parseIncomingText(
  text: string,
  customAmountRegex?: string,
): { amount: number; accountType: string; payerAccount?: string; paidAt?: Date; hint: string } {
  let amount: number | undefined;
  let hint = 'default';

  if (customAmountRegex) {
    const m = new RegExp(customAmountRegex).exec(text);
    if (m?.[1]) {
      amount = Number(m[1]);
      hint = 'custom';
    }
  }
  if (amount === undefined) {
    for (const re of AMOUNT_PATTERNS) {
      const m = re.exec(text);
      if (m?.[1]) {
        amount = Number(m[1]);
        break;
      }
    }
  }
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    throw new BizException(ErrorCode.PARAM_ERROR, `无法从文本解析出金额：${text.slice(0, 60)}`);
  }

  const hasIncome = INCOME_HINTS.some((w) => text.includes(w));
  const hasOutcome = OUTCOME_HINTS.some((w) => text.includes(w));
  if (!hasIncome && hasOutcome) {
    throw new BizException(
      ErrorCode.PARAM_ERROR,
      '该文本看起来是「付款/支出」通知而非收款通知，已拒绝（避免把支出记为收入）',
    );
  }
  if (!hasIncome) {
    throw new BizException(
      ErrorCode.PARAM_ERROR,
      '文本中没有收款语义词（收款/到账/入账/收入/收到），无法确认为到账，已拒绝',
    );
  }

  // 账户类型
  let accountType = 'other';
  if (/微信|WeChat|wechat|财付通/.test(text)) accountType = 'wechat';
  else if (/支付宝|Alipay|alipay|花呗|余额宝|网商/.test(text)) accountType = 'alipay';
  else if (/银行|储蓄卡|借记卡|尾号|余额|农行|工行|建行|招行|中行|交行|邮储|信用社|联合银行/.test(text)) {
    accountType = 'bank';
  }

  // 付款方
  let payerAccount: string | undefined;
  for (const re of PAYER_PATTERNS) {
    const m = re.exec(text);
    if (m?.[1]) {
      payerAccount = m[1].trim();
      break;
    }
  }

  // 时间：支持「09月20日15:30」与「15:30」
  let paidAt: Date | undefined;
  const tm = /(?:(\d{1,2})\s*月\s*(\d{1,2})\s*日)?\s*(?:(\d{1,2})\s*[:：]\s*(\d{2}))/.exec(text);
  if (tm) {
    const now = new Date();
    const month = tm[1] ? Number(tm[1]) : now.getMonth() + 1;
    const day = tm[1] ? Number(tm[2]) : now.getDate();
    const hour = Number(tm[3]);
    const minute = Number(tm[4]);
    let d = new Date(now.getFullYear(), month - 1, day, hour, minute, 0, 0);
    // 跨年：解析结果比现在晚一天以上，说明是去年的通知（如 12 月报 1 月的账）
    if (d.getTime() - now.getTime() > 24 * 3600 * 1000) {
      d = new Date(now.getFullYear() - 1, month - 1, day, hour, minute, 0, 0);
    }
    if (!Number.isNaN(d.getTime())) paidAt = d;
  }

  return { amount, accountType, payerAccount, paidAt, hint };
}
