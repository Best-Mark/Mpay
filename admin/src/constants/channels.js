/**
 * 渠道元数据（与后端 src/modules/channel/channel-meta.ts 保持一致）
 * 渠道配置表单按此渲染：场景选项、商户号/AppId 格式提示、密钥字段显隐与必填。
 */
export const SCENE_OPTIONS = {
  JSAPI: 'JSAPI（公众号 / 小程序）',
  NATIVE: 'NATIVE（扫码）',
  APP: 'APP',
  MWEB: 'MWEB（H5）',
  PC: 'PC（电脑网站）',
  FACE_TO_FACE: 'FACE_TO_FACE（付款码）',
};

export const CHANNEL_META = {
  wechat: {
    label: '微信支付',
    mchId: {
      label: '商户号 mchId',
      pattern: /^\d{10}$/,
      placeholder: '微信支付商户号',
      hint: '10 位纯数字',
    },
    appId: {
      label: 'AppId',
      pattern: /^wx[0-9a-zA-Z]{16}$/,
      placeholder: '公众号 / 小程序 AppID',
      hint: 'wx 开头共 18 位',
    },
    scenes: ['JSAPI', 'NATIVE', 'APP', 'MWEB', 'FACE_TO_FACE'],
    secrets: [
      { key: 'certSerialNo', label: '证书序列号', type: 'text', placeholder: 'apiclient_cert.pem 中的序列号（40 位十六进制）', required: true },
      { key: 'apiV3Key', label: 'APIv3 密钥', type: 'password', placeholder: '商户平台设置的 APIv3 密钥（32 位）', required: true },
      { key: 'privateKey', label: '商户私钥', type: 'textarea', placeholder: 'apiclient_key.pem 完整 PEM 内容', hint: '需包含 -----BEGIN PRIVATE KEY----- 头尾', required: true },
      { key: 'platformCert', label: '微信平台证书', type: 'textarea', placeholder: '平台证书 PEM（用于回调验签）', hint: '商户平台「API 安全」下载' },
    ],
  },
  alipay: {
    label: '支付宝',
    mchId: {
      label: '合作者身份 PID',
      pattern: /^\d{16}$/,
      placeholder: '支付宝合作者身份 ID',
      hint: '16 位纯数字',
    },
    appId: {
      label: '应用 APPID',
      pattern: /^\d{16}$/,
      placeholder: '开放平台应用 APPID',
      hint: '2021 开头 16 位数字',
    },
    scenes: ['PC', 'NATIVE', 'APP', 'MWEB', 'FACE_TO_FACE'],
    secrets: [
      { key: 'signType', label: '签名类型', type: 'select', options: [{ label: 'RSA2（推荐）', value: 'RSA2' }, { label: 'RSA（旧接口）', value: 'RSA' }] },
      { key: 'privateKey', label: '应用私钥', type: 'textarea', placeholder: '密钥工具生成的应用私钥（PKCS8）', required: true },
      { key: 'platformCert', label: '支付宝公钥', type: 'textarea', placeholder: '开放平台「接口加签方式」查看', required: true },
    ],
  },
  unionpay: {
    label: '银联 / 云闪付',
    mchId: {
      label: '商户号 merId',
      pattern: /^\d{15}$/,
      placeholder: '银联入网商户号',
      hint: '15 位纯数字',
    },
    appId: null,
    scenes: ['PC', 'NATIVE', 'MWEB', 'APP'],
    secrets: [
      { key: 'certSerialNo', label: '证书 ID（certId）', type: 'text', placeholder: '银联签名证书编号', required: true },
      { key: 'privateKey', label: '签名私钥', type: 'textarea', placeholder: '签名证书对应私钥 PEM', hint: '与证书 ID 成对，需含 PEM 头尾', required: true },
      { key: 'platformCert', label: '验签公钥证书', type: 'textarea', placeholder: '银联签名公钥证书 PEM', required: true },
    ],
  },
  mock: {
    label: '模拟渠道',
    mchId: { label: '模拟商户号', placeholder: '如 MOCK_MCH_001', hint: '仅用于沙箱联调' },
    appId: null,
    scenes: Object.keys(SCENE_OPTIONS),
    secrets: [],
  },

  // ===== 已登记、适配器未接入（下拉置灰，保存会被后端拒绝） =====
  jd: { label: '京东支付', available: false, reason: '需京东科技开放平台商户号与接口文档', mchId: { label: '商户号', placeholder: '京东科技分配的商户号' }, appId: null, scenes: [], secrets: [] },
  qq: { label: 'QQ 钱包', available: false, reason: '财付通生态内，需腾讯侧开通', mchId: { label: '商户号', placeholder: '财付通商户号' }, appId: null, scenes: [], secrets: [] },
  digital_rmb: { label: '数字人民币', available: false, reason: '需运营机构白名单准入', mchId: { label: '运营机构商户号' }, appId: null, scenes: [], secrets: [] },
  paypal: { label: 'PayPal（跨境）', available: false, reason: '需跨境主体与境外结算账户', mchId: { label: 'Merchant ID' }, appId: null, scenes: [], secrets: [] },
  douyin: { label: '抖音支付', available: false, reason: '仅抖音小程序担保支付，未开放通用收单', mchId: { label: '小程序商户号' }, appId: null, scenes: [], secrets: [] },
};

/** 已接入渠道（可保存配置并真实下单） */
export const CHANNEL_OPTIONS = [
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
  { value: 'unionpay', label: '银联 / 云闪付（含银行卡）' },
  { value: 'mock', label: '模拟渠道' },
];

/**
 * 已登记但尚未接入的渠道（下拉里置灰展示，保存会被后端拒绝）
 * 接入前提各不相同：要么渠道方未开放通用收单接口，要么需要白名单 / 跨境主体。
 */
export const PLANNED_CHANNEL_OPTIONS = [
  { value: 'jd', label: '京东支付', reason: '需京东科技开放平台商户号与接口文档' },
  { value: 'qq', label: 'QQ 钱包', reason: '财付通生态内，需腾讯侧开通' },
  { value: 'digital_rmb', label: '数字人民币', reason: '需运营机构白名单准入' },
  { value: 'paypal', label: 'PayPal（跨境）', reason: '需跨境主体与境外结算账户' },
  { value: 'douyin', label: '抖音支付', reason: '仅抖音小程序担保支付，未开放通用收单' },
];

export const channelName = (c) =>
  ({ wechat: '微信支付', alipay: '支付宝', unionpay: '银联 / 云闪付', mock: '模拟渠道' }[c] || c);
