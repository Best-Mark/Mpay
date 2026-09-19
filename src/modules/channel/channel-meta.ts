import { Channel, TradeType } from '../../common/constants/enums';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/** 渠道支持的场景 */
const SCENES: Record<string, string[]> = {
  [Channel.WECHAT]: [TradeType.JSAPI, TradeType.NATIVE, TradeType.APP, TradeType.MWEB, TradeType.FACE_TO_FACE],
  [Channel.ALIPAY]: [TradeType.PC, TradeType.NATIVE, TradeType.APP, TradeType.MWEB, TradeType.FACE_TO_FACE],
  [Channel.UNIONPAY]: [TradeType.PC, TradeType.NATIVE, TradeType.MWEB, TradeType.APP],
  [Channel.MOCK]: Object.values(TradeType),
};

export interface SecretFieldDef {
  /** 对应 ChannelConfig 列名 */
  key: 'certSerialNo' | 'apiV3Key' | 'privateKey' | 'platformCert' | 'signType';
  label: string;
  /** 表单类型（前端渲染用） */
  type?: 'text' | 'password' | 'textarea' | 'select';
  placeholder?: string;
  hint?: string;
  options?: { label: string; value: string }[];
  /** 新增时是否必填 */
  required?: boolean;
}

export interface ChannelMeta {
  label: string;
  /** 是否已实现下单适配器（false = 仅登记展示，保存配置时拒绝） */
  available: boolean;
  /** 未接入原因 / 接入前提（前端与接口报错都会展示） */
  reason?: string;
  scenes: string[];
  mchId?: { label: string; pattern?: RegExp; placeholder?: string; hint?: string };
  appId?: { label: string; pattern?: RegExp; placeholder?: string; hint?: string };
  secrets: SecretFieldDef[];
}

/**
 * 渠道元数据（唯一权威，后台配置表单按此渲染）
 * 新增渠道：在此登记 + 实现 adapter + channel.service.build() 加 case
 */
export const CHANNEL_META: Record<string, ChannelMeta> = {
  [Channel.WECHAT]: {
    label: '微信支付',
    available: true,
    scenes: SCENES[Channel.WECHAT],
    mchId: {
      label: '商户号 mchId',
      pattern: /^\d{10}$/,
      placeholder: '微信支付商户号',
      hint: '10 位纯数字（mchId）',
    },
    appId: {
      label: 'AppId',
      pattern: /^wx[0-9a-zA-Z]{16}$/,
      placeholder: '公众号 / 小程序 AppID',
      hint: 'wx 开头共 18 位',
    },
    secrets: [
      { key: 'certSerialNo', label: '证书序列号', type: 'text', placeholder: 'apiclient_cert.pem 里的序列号（40 位十六进制）', required: true },
      { key: 'apiV3Key', label: 'APIv3 密钥', type: 'password', placeholder: '微信商户平台设置的 APIv3 密钥（32 位）', required: true },
      { key: 'privateKey', label: '商户私钥', type: 'textarea', placeholder: 'apiclient_key.pem 的完整 PEM 内容', hint: '需包含 -----BEGIN PRIVATE KEY----- 头尾', required: true },
      { key: 'platformCert', label: '微信平台证书', type: 'textarea', placeholder: '平台证书 PEM（用于回调验签）', hint: '商户平台「API 安全」下载' },
    ],
  },
  [Channel.ALIPAY]: {
    label: '支付宝',
    available: true,
    scenes: SCENES[Channel.ALIPAY],
    mchId: {
      label: '合作者身份 PID',
      pattern: /^\d{16}$/,
      placeholder: '支付宝合作者身份 ID（PID）',
      hint: '16 位纯数字',
    },
    appId: {
      label: '应用 APPID',
      pattern: /^\d{16}$/,
      placeholder: '开放平台应用 APPID',
      hint: '2021 开头 16 位数字',
    },
    secrets: [
      { key: 'signType', label: '签名类型', type: 'select', options: [{ label: 'RSA2（推荐）', value: 'RSA2' }, { label: 'RSA（旧接口）', value: 'RSA' }] },
      { key: 'privateKey', label: '应用私钥', type: 'textarea', placeholder: '密钥工具生成的应用私钥（PKCS8）', required: true },
      { key: 'platformCert', label: '支付宝公钥', type: 'textarea', placeholder: '开放平台「接口加签方式」里的支付宝公钥', required: true },
    ],
  },
  [Channel.UNIONPAY]: {
    label: '银联 / 云闪付',
    available: true,
    scenes: SCENES[Channel.UNIONPAY],
    mchId: {
      label: '商户号 merId',
      pattern: /^\d{15}$/,
      placeholder: '银联入网商户号',
      hint: '15 位纯数字',
    },
    secrets: [
      { key: 'certSerialNo', label: '证书 ID（certId）', type: 'text', placeholder: '银联签名证书的证书编号', required: true },
      { key: 'privateKey', label: '签名私钥', type: 'textarea', placeholder: 'acp_test_spk? 签名证书对应私钥 PEM', hint: '与证书 ID 成对，需含 PEM 头尾', required: true },
      { key: 'platformCert', label: '验签公钥证书', type: 'textarea', placeholder: '银联签名公钥证书 PEM（用于回调/应答验签）', required: true },
    ],
  },
  [Channel.MOCK]: {
    label: '模拟渠道',
    available: true,
    scenes: SCENES[Channel.MOCK],
    mchId: { label: '模拟商户号', placeholder: '如 MOCK_MCH_001', hint: '仅用于沙箱联调' },
    secrets: [],
  },

  // ==================== 已登记、尚未接入（available=false：可展示，保存时明确拒绝）====================

  [Channel.JD]: {
    label: '京东支付',
    available: false,
    reason: '京东科技开放平台有对外网关（一次对接京东 / 微信 / 支付宝钱包），需先拿到商户号与接口文档再实现适配器',
    scenes: [],
    mchId: { label: '商户号', placeholder: '京东科技分配的商户号', hint: '需京东支付开放平台开通' },
    secrets: [],
  },
  [Channel.QQ]: {
    label: 'QQ 钱包',
    available: false,
    reason: '财付通生态内渠道，需腾讯侧开通，当前市场份额小，按需接入',
    scenes: [],
    mchId: { label: '商户号', placeholder: '财付通商户号' },
    secrets: [],
  },
  [Channel.DIGITAL_RMB]: {
    label: '数字人民币',
    available: false,
    reason: '需经运营机构（工行 / 建行 / 网商等）白名单准入，接口由运营机构下发，无公开统一网关',
    scenes: [],
    mchId: { label: '运营机构商户号', placeholder: '由运营机构分配' },
    secrets: [],
  },
  [Channel.PAYPAL]: {
    label: 'PayPal（跨境）',
    available: false,
    reason: '跨境收单，需跨境 / 境外主体、境外结算账户与外币对账能力，按跨境版图规划接入',
    scenes: [],
    mchId: { label: 'Merchant ID', placeholder: 'PayPal 商户 ID' },
    secrets: [],
  },
  [Channel.DOUYIN]: {
    label: '抖音支付',
    available: false,
    reason: '抖音支付仅面向抖音小程序生态提供「担保支付」，未开放通用收单接口，第三方聚合支付无法直接接入',
    scenes: [],
    mchId: { label: '小程序商户号', placeholder: '抖音开放平台分配' },
    secrets: [],
  },
};

/** 已接入（可保存配置并下单）的渠道 */
export const AVAILABLE_CHANNELS = Object.entries(CHANNEL_META)
  .filter(([, m]) => m.available)
  .map(([k]) => k);

const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * 渠道配置合法性校验（新增 / 编辑共用）
 * 原则：字段格式与渠道一一对应，避免「配了密钥却连不上渠道」的隐性故障
 */
export function validateChannelConfig(
  channel: string,
  input: {
    mchId?: string;
    channelAppId?: string;
    scene?: string | null;
    privateKey?: string;
    platformCert?: string;
    certSerialNo?: string;
    apiV3Key?: string;
  },
  isCreate: boolean,
): void {
  const meta = CHANNEL_META[channel];
  if (!meta) throw new BizException(ErrorCode.PARAM_ERROR, `未知渠道: ${channel}`);
  if (meta.available === false) {
    throw new BizException(
      ErrorCode.PARAM_ERROR,
      `渠道「${meta.label}」尚未接入，暂不能保存配置${meta.reason ? `：${meta.reason}` : ''}`,
    );
  }

  // 场景合法性（空 = 全部场景）
  if (input.scene && meta.scenes.length && !meta.scenes.includes(input.scene)) {
    throw new BizException(
      ErrorCode.PARAM_ERROR,
      `渠道「${meta.label}」不支持场景 ${input.scene}，可选：${meta.scenes.join(' / ')}`,
    );
  }

  // 商户号格式
  if (input.mchId !== undefined) {
    const v = (input.mchId || '').trim();
    if (!v) throw new BizException(ErrorCode.PARAM_ERROR, `${meta.mchId?.label || '商户号'} 必填`);
    if (meta.mchId?.pattern && !meta.mchId.pattern.test(v)) {
      throw new BizException(ErrorCode.PARAM_ERROR, `${meta.mchId.label} 格式不正确：${meta.mchId.hint || ''}`);
    }
  }

  // AppId 格式
  if (input.channelAppId !== undefined && input.channelAppId !== '') {
    if (meta.appId?.pattern && !meta.appId.pattern.test(input.channelAppId.trim())) {
      throw new BizException(ErrorCode.PARAM_ERROR, `${meta.appId.label} 格式不正确：${meta.appId.hint || ''}`);
    }
  } else if (isCreate && meta.appId) {
    throw new BizException(ErrorCode.PARAM_ERROR, `渠道「${meta.label}」必须填写${meta.appId.label}`);
  }

  // 密钥类字段：新增时必填项校验 + 格式校验
  for (const f of meta.secrets) {
    const v = (input as Record<string, any>)[f.key];
    const filled = typeof v === 'string' && v.trim() !== '';
    if (f.required && isCreate && !filled) {
      throw new BizException(ErrorCode.PARAM_ERROR, `渠道「${meta.label}」必须填写「${f.label}」`);
    }
    if (!filled) continue;
    if (f.key === 'privateKey' && channel !== Channel.ALIPAY && !PEM_RE.test(v)) {
      throw new BizException(ErrorCode.PARAM_ERROR, `「${f.label}」需为完整 PEM 格式（含 -----BEGIN 头尾）`);
    }
    if (f.key === 'apiV3Key' && v.trim().length !== 32) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'APIv3 密钥固定为 32 位');
    }
    if (f.key === 'certSerialNo' && channel === Channel.WECHAT && !/^[0-9A-Fa-f]{40}$/.test(v.trim())) {
      throw new BizException(ErrorCode.PARAM_ERROR, '微信证书序列号为 40 位十六进制');
    }
  }
}
