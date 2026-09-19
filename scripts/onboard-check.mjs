/**
 * 业务项目接入自检：用项目自己的 AppId/AppSecret 跑一遍全链路
 *
 * 基础自检（不需要公网地址）：
 *   node scripts/onboard-check.mjs --base https://pay.7zan.com --app-id app_xxx --app-secret sss
 *
 * 连「项目自己的通知处理器」一起验（需要一条公网隧道，如 ngrok / cloudflared）：
 *   ngrok http 8787
 *   node scripts/onboard-check.mjs --base https://pay.7zan.com --app-id app_xxx --app-secret sss \
 *        --public-base https://abcd.ngrok-free.app --port 8787 \
 *        --forward http://localhost:3000/api/pay/notify
 *
 * 参数：
 *   --base        支付中心地址（默认 http://localhost:3000）
 *   --app-id      项目 AppId
 *   --app-secret  项目 AppSecret
 *   --channel     下单渠道（默认 mock；真实渠道需自行在收银台付款）
 *   --amount      下单金额（默认 12.34）
 *   --public-base 公网隧道地址，用于接收支付中心通知（不传则跳过通知检查）
 *   --forward     项目自己的通知处理地址，脚本收到通知后转发过去，验证其应答与幂等
 *   --port        本地监听端口（配合 --public-base，默认 8787）
 *   --wait        等待通知的秒数（默认 40）
 *
 * 全部 ✅ 才说明接入合格；任一项 ❌ 按提示修。
 */
import http from 'http';
import crypto from 'crypto';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const APP_ID = arg('app-id', '');
const APP_SECRET = arg('app-secret', '');
const CHANNEL = arg('channel', 'mock');
const AMOUNT = arg('amount', '12.34');
const PUBLIC_BASE = (arg('public-base', '') || '').replace(/\/$/, '');
const FORWARD = arg('forward', '');
const PORT = Number(arg('port', '8787'));
const WAIT_SEC = Number(arg('wait', '40'));
const NOTIFY_PATH = '/__onboard/notify';

if (!APP_ID || !APP_SECRET) {
  console.error('\n❌ 请提供 --app-id 与 --app-secret\n');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => Date.now();

async function api(path, body, headers = {}) {
  const bodyStr = JSON.stringify(body ?? {});
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  });
  return { status: res.status, json: await res.json().catch(() => ({ code: -1, message: '响应解析失败' })) };
}

/** 开放接口签名：appId\nts\nnonce\nMETHOD\npath\nsha256(body) */
function signedHeaders(path, bodyObj, { corrupt = false } = {}) {
  const bodyStr = JSON.stringify(bodyObj);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const content = [APP_ID, timestamp, nonce, 'POST', path, bodyHash].join('\n');
  const sign = corrupt
    ? 'deadbeef'
    : crypto.createHmac('sha256', APP_SECRET).update(content).digest('hex').toLowerCase();
  return { body: bodyStr, headers: { 'X-App-Id': APP_ID, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign } };
}

async function call(path, body, opts = {}) {
  const { body: bodyStr, headers } = signedHeaders(path, body, opts);
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: bodyStr });
  return await res.json().catch(() => ({ code: -1, message: '响应解析失败' }));
}

/** 通知验签：与 SDK 的 verifyNotify 完全一致 */
function verifyNotify(headers, rawBody) {
  const content = [
    headers['x-pay-app-id'] || '',
    headers['x-pay-timestamp'] || '',
    headers['x-pay-nonce'] || '',
    crypto.createHash('sha256').update(rawBody).digest('hex'),
  ].join('\n');
  const expected = crypto.createHmac('sha256', APP_SECRET).update(content).digest('hex').toLowerCase();
  return expected === String(headers['x-pay-sign'] || '').toLowerCase();
}

/** 与平台一致的「业务系统成功标识」判定 */
function isSuccessResponse(data) {
  if (typeof data === 'string') {
    const s = data.trim().toUpperCase();
    return s === 'SUCCESS' || s === 'OK' || s.includes('SUCCESS');
  }
  if (data && typeof data === 'object') {
    if (data.code === 0 || data.code === '0') return true;
    if (data.success === true || data.errcode === 0) return true;
    if (typeof data.data === 'string' && data.data.trim().toUpperCase() === 'SUCCESS') return true;
  }
  return false;
}

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  ok ? passed++ : failed++;
}

// ==================== 通知接收器 ====================
async function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith(NOTIFY_PATH)) {
      res.statusCode = 404;
      return res.end();
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({ headers: req.headers, raw, at: Date.now() });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 0 })); // 告诉平台：已收到
    });
  });
  await new Promise((r) => server.listen(PORT, r));
  return { received, close: () => server.close() };
}

async function waitFor(received, predicate, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = received.find(predicate);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

async function forwardTo(raw, headers) {
  const outHeaders = { 'Content-Type': 'application/json' };
  for (const k of Object.keys(headers)) {
    if (k.startsWith('x-pay-')) outHeaders[k] = headers[k];
  }
  const res = await fetch(FORWARD, { method: 'POST', headers: outHeaders, body: raw });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* 纯文本应答 */ }
  return { status: res.status, parsed, text };
}

// ==================== 主流程 ====================
console.log(`\n=== 接入自检 → ${BASE}  appId=${APP_ID} ===\n`);

let receiver = null;
if (PUBLIC_BASE) {
  receiver = await startReceiver();
  console.log(`通知接收器已启动：本地 :${PORT}  公网 ${PUBLIC_BASE}${NOTIFY_PATH}`);
  if (FORWARD) console.log(`收到通知后转发给项目处理器：${FORWARD}（并重复一次验证幂等）`);
  console.log('');
}

const notifyUrl = PUBLIC_BASE ? PUBLIC_BASE + NOTIFY_PATH : undefined;

// 1. 渠道发现
const channels = await call('/api/v1/open/pay/channels', { appId: APP_ID });
const channelList = channels?.data?.channels || channels?.data || [];
check('渠道发现 listChannels', channels?.code === 0 && Array.isArray(channelList), `可用渠道=${channelList.map((c) => c.channel || c).join('/') || '-'}`);

// 2. 下单
const orderNo = `ONBOARD${ts()}`;
const orderBody = {
  appId: APP_ID,
  merchantOrderNo: orderNo,
  amount: AMOUNT,
  subject: '接入自检订单',
  channel: CHANNEL,
  tradeType: 'JSAPI',
  notifyUrl,
  extra: { onboard: true },
};
const created = await call('/api/v1/open/pay/create', orderBody);
const payOrderNo = created?.data?.payOrderNo;
check('统一下单', created?.code === 0 && !!payOrderNo, `payOrderNo=${payOrderNo || '-'}`);
if (!payOrderNo) {
  console.log(`\n下单失败：${created?.message}（code=${created?.code}，traceId=${created?.traceId}）\n`);
  process.exit(1);
}
check('下单返回 payInfo（与渠道无关）', !!created?.data?.payInfo?.type, `type=${created?.data?.payInfo?.type}`);

// 3. 幂等
const again = await call('/api/v1/open/pay/create', orderBody);
check('下单幂等（同 merchantOrderNo 返回同一订单）', again?.data?.payOrderNo === payOrderNo);

// 4. 错签必须被拒
const bad = await call('/api/v1/open/pay/create', { ...orderBody, merchantOrderNo: `${orderNo}_x` }, { corrupt: true });
check('签名校验（错误签名被拒绝）', bad?.code !== 0, `code=${bad?.code}`);

// 5. 支付（通知计时基准：从这一刻起算推送耗时）
const waitStart = Date.now();
if (CHANNEL === 'mock') {
  const paid = await api(`/api/v1/mock/pay/${payOrderNo}/success`);
  check('模拟支付成功', paid.json?.code === 0, paid.json?.code !== 0 ? paid.json?.message || '' : '');
} else {
  console.log(`⏳ 渠道=${CHANNEL}，请在收银台完成支付，脚本将轮询查单 ${WAIT_SEC}s …`);
}

// 6. 查单直到 SUCCESS
let status = '';
const deadline = Date.now() + (CHANNEL === 'mock' ? 15000 : WAIT_SEC * 1000);
while (Date.now() < deadline) {
  const q = await call('/api/v1/open/pay/query', { appId: APP_ID, payOrderNo });
  status = q?.data?.status;
  if (status === 'SUCCESS') break;
  await sleep(1000);
}
check('订单查询 SUCCESS', status === 'SUCCESS', `status=${status || '-'}`);

// 7. 通知（需要公网地址）
if (receiver) {
  const hit = await waitFor(receiver.received, (n) => {
    try { return JSON.parse(n.raw).payOrderNo === payOrderNo; } catch { return false; }
  }, WAIT_SEC * 1000);

  check('收到支付通知', !!hit, hit ? `推送耗时 ${((hit.at - waitStart) / 1000).toFixed(1)}s` : `等待 ${WAIT_SEC}s 未收到`);

  if (hit) {
    check('通知验签通过', verifyNotify(hit.headers, hit.raw), `sign=${String(hit.headers['x-pay-sign'] || '').slice(0, 12)}…`);
    const n = JSON.parse(hit.raw);
    const required = ['bizType', 'event', 'payOrderNo', 'merchantOrderNo', 'appId', 'amount', 'status'];
    const missing = required.filter((k) => n[k] === undefined);
    check('通知字段完整', missing.length === 0, missing.length ? `缺少 ${missing.join(',')}` : `${n.bizType}/${n.event}`);

    if (FORWARD) {
      const f1 = await forwardTo(hit.raw, hit.headers);
      check('项目通知处理器应答成功标识', f1.status < 400 && isSuccessResponse(f1.parsed), `HTTP ${f1.status} body=${f1.text.slice(0, 60)}`);
      const f2 = await forwardTo(hit.raw, hit.headers);
      check('重复通知幂等（重放仍返回成功）', f2.status < 400 && isSuccessResponse(f2.parsed), `HTTP ${f2.status}`);
    }
  }
} else {
  console.log('ℹ️  跳过通知检查：未传 --public-base（需要公网隧道地址才能收到通知）');
}

// 8. 退款
const refundNo = `ONBOARD-R${ts()}`;
const refundBody = { appId: APP_ID, payOrderNo, merchantRefundNo: refundNo, amount: '1.00', reason: '接入自检部分退款', notifyUrl };
const refunded = await call('/api/v1/open/refund/create', refundBody);
check('部分退款', refunded?.code === 0, `refundNo=${refunded?.data?.refundNo || '-'} status=${refunded?.data?.status || '-'}`);

const rq = await call('/api/v1/open/refund/query', { appId: APP_ID, merchantRefundNo: refundNo });
check('退款查询', rq?.code === 0 && !!rq?.data?.refundNo, `status=${rq?.data?.status || '-'}`);

const refundAgain = await call('/api/v1/open/refund/create', refundBody);
check('退款幂等（同 merchantRefundNo）', refundAgain?.code === 0 && refundAgain?.data?.refundNo === refunded?.data?.refundNo);

// 9. 关单
const closeNo = `ONBOARD-C${ts()}`;
const c1 = await call('/api/v1/open/pay/create', { appId: APP_ID, merchantOrderNo: closeNo, amount: '1.00', subject: '自检关单', channel: CHANNEL });
const closed = await call('/api/v1/open/pay/close', { appId: APP_ID, payOrderNo: c1?.data?.payOrderNo });
const cq = await call('/api/v1/open/pay/query', { appId: APP_ID, payOrderNo: c1?.data?.payOrderNo });
check('关闭未支付订单', closed?.code === 0 && cq?.data?.status === 'CLOSED', `status=${cq?.data?.status || '-'}`);

receiver?.close();

console.log(`\n=== 自检完成：通过 ${passed} 项，失败 ${failed} 项 ===`);
if (failed === 0) {
  console.log('接入合格。上线前请对照 docs/sdk/INTEGRATION.md 的验收清单再过一遍。\n');
} else {
  console.log('存在不合格项，请按上面 ❌ 提示修正后重跑。常见问题见 docs/sdk/INTEGRATION.md 第 7 节。\n');
  process.exitCode = 1;
}
