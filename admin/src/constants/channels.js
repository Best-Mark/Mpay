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
};

/** 全部渠道下拉（bank：银行卡收单统一走银联通道，预留展示） */
export const CHANNEL_OPTIONS = [
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
  { value: 'unionpay', label: '银联 / 云闪付（含银行卡）' },
  { value: 'mock', label: '模拟渠道' },
];

export const channelName = (c) =>
  ({ wechat: '微信支付', alipay: '支付宝', unionpay: '银联 / 云闪付', mock: '模拟渠道' }[c] || c);
