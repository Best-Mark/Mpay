/**
 * 开放接口（/api/v1/open/**）v1 契约 —— 向前兼容的**硬性约束**
 *
 * 业务系统接一次 SDK 之后，平台侧的任何演进都不能让已有代码失效。为此定死三条：
 *
 * 1. **路径与包裹结构长期不变**：`{ code, message, data, traceId }`，路径见 OPEN_API_PATHS
 * 2. **只允许新增字段**：禁止删除 / 改名 / 改类型 / 改变语义
 * 3. **破坏性变更走新版本路径**：新增 `/api/v2/...`，v1 继续可用直到公告下线
 *
 * 保障手段（让「约束」真的不可绕）：
 * - `OpenApiOrderView`：订单响应被标注为该类型，删字段直接 `npm run build` 失败
 * - `scripts/openapi-compat-check.ts`：对比 `docs/openapi/v1-baseline.json`，
 *   路径 / 字段 / payInfo 形态只允许增不允许减，建议接进 CI 与发布流程
 * - `X-Api-Version` 响应头：业务系统与 SDK 可据此协商版本
 *
 * 新增字段流程：改代码 → 跑 `npm run compat:check` → 确认 diff 只有新增 → 更新基线文件。
 */
export const OPEN_API_VERSION = 1;

/** v1 开放接口路径：只允许新增，禁止修改或删除（老 SDK 里写死了这些路径） */
export const OPEN_API_PATHS = [
  '/api/v1/open/pay/create',
  '/api/v1/open/pay/query',
  '/api/v1/open/pay/close',
  '/api/v1/open/pay/channels',
  '/api/v1/open/refund/create',
  '/api/v1/open/refund/query',
] as const;

/**
 * 订单响应字段（下单 / 查单 / 关单 / 详情共用）
 * 删除其中任何一项都会导致编译失败 —— 这是向前兼容的编译期门禁
 */
export const ORDER_RESPONSE_FIELDS = [
  'payOrderNo',
  'merchantOrderNo',
  'appId',
  'channel',
  'channelMchId',
  'tradeType',
  'amount',
  'refundedAmount',
  'paidAmount',
  'subject',
  'body',
  'attach',
  'status',
  'channelTxnId',
  'payerId',
  'paidAt',
  'expireAt',
  'closedAt',
  'notifyStatus',
  'notifyCount',
  'payParams',
  'payInfo',
  'createdAt',
  'updatedAt',
  'idempotentHit',
] as const;

export type OrderResponseField = (typeof ORDER_RESPONSE_FIELDS)[number];

/** 订单响应视图：类型层面保证字段齐全 */
export type OpenApiOrderView = Record<OrderResponseField, any>;

/**
 * payInfo 形态：与渠道无关的渲染契约（见 channel.types.PayInfoType）
 * 新增形态时，老业务会因 default 分支走「轮询查单 + raw 兜底」，不会崩溃
 */
export const PAY_INFO_TYPES = ['qrcode', 'jsapi', 'app', 'redirect', 'form', 'none'] as const;
