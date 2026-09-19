/**
 * 全链路冒烟测试：
 *   管理员登录 → 创建业务系统 → 签名下单 → 模拟支付 → 查询订单
 *   → 触发当日对账 → 查看对账报告与差异
 * 用法：node scripts/smoke-test.mjs [baseUrl]
 */
import crypto from 'crypto';

const BASE = process.argv[2] || 'http://localhost:3000';

async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** 开放接口签名（与服务端一致：appId\nts\nnonce\nMETHOD\npath\nsha256(body)） */
function signedHeaders(appId, appSecret, path, bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const content = [appId, timestamp, nonce, 'POST', path, bodyHash].join('\n');
  const sign = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return { 'X-App-Id': appId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign };
}

const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

console.log(`\n=== Mpay 全链路冒烟测试 → ${BASE} ===\n`);

// 1. 管理员登录
const login = await api('POST', '/api/admin/login', { username: 'admin', password: 'Pay@admin123' });
const token = login.json?.data?.token;
ok('管理员登录', !!token);

const auth = { Authorization: `Bearer ${token}` };

// 2. 创建业务系统
const mchName = `冒烟测试-${Date.now()}`;
const mch = await api('POST', '/api/admin/merchants', { name: mchName, payNotifyUrl: 'http://localhost:9999/notify', allowChannels: ['mock'] }, auth);
const appId = mch.json?.data?.appId;
const appSecret = mch.json?.data?.appSecret;
ok('创建业务系统', !!appId && !!appSecret, `appId=${appId}`);

// 3. 签名下单
const orderBody = {
  appId,
  merchantOrderNo: `SMOKE${Date.now()}`,
  amount: '12.34',
  subject: '冒烟测试商品',
  channel: 'mock',
  tradeType: 'JSAPI',
  extra: { demo: true },
};
const bodyStr = JSON.stringify(orderBody);
const create = await api('POST', '/api/v1/open/pay/create', orderBody, signedHeaders(appId, appSecret, '/api/v1/open/pay/create', bodyStr));
const payOrderNo = create.json?.data?.payOrderNo;
ok('统一下单', create.json?.code === 0 && !!payOrderNo, `payOrderNo=${payOrderNo}`);

// 3.1 幂等：重复下单应返回同一订单
const bodyStr2 = JSON.stringify(orderBody);
const create2 = await api('POST', '/api/v1/open/pay/create', orderBody, signedHeaders(appId, appSecret, '/api/v1/open/pay/create', bodyStr2));
ok('下单幂等（重复请求返回同一订单）', create2.json?.data?.payOrderNo === payOrderNo);

// 3.2 签名防篡改：错误签名应被拒绝
const badSign = await api('POST', '/api/v1/open/pay/create', orderBody, {
  'X-App-Id': appId,
  'X-Timestamp': Math.floor(Date.now() / 1000).toString(),
  'X-Nonce': crypto.randomBytes(12).toString('hex'),
  'X-Sign': 'deadbeef',
});
ok('签名校验（错误签名被拒绝）', badSign.json?.code !== 0, `code=${badSign.json?.code}`);

// 4. 模拟支付（触发渠道回调 → 状态流转 → 通知业务系统）
const pay = await api('POST', `/api/v1/mock/pay/${payOrderNo}/success`);
ok('模拟支付成功', pay.json?.code === 0, `金额=${pay.json?.data?.amount}`);

// 5. 查询订单
await new Promise((r) => setTimeout(r, 800));
const q1 = await api('POST', '/api/v1/open/pay/query', { payOrderNo }, signedHeaders(appId, appSecret, '/api/v1/open/pay/query', JSON.stringify({ payOrderNo })));
ok('支付查询（SUCCESS）', q1.json?.data?.status === 'SUCCESS', `status=${q1.json?.data?.status}`);

// 6. 退款 5 元
const refundBody = { payOrderNo, merchantRefundNo: `SMOKE-R${Date.now()}`, amount: '5.00', reason: '冒烟测试部分退款' };
const refund = await api('POST', '/api/v1/open/refund/create', refundBody, signedHeaders(appId, appSecret, '/api/v1/open/refund/create', JSON.stringify(refundBody)));
ok('部分退款', refund.json?.code === 0, `refundNo=${refund.json?.data?.refundNo} status=${refund.json?.data?.status}`);

// 7. 触发当日对账（渠道 mock；注意用本地日期，toISOString 是 UTC 会差一天）
const billDate = new Date().toLocaleDateString('sv-SE');
const run = await api('POST', '/api/admin/reconcile/run', { billDate, channel: 'mock', autoFetch: true, forceFetch: true }, auth);
ok('手动触发对账', run.json?.code === 0, `平账=${run.json?.data?.matchedCount} 差异=${run.json?.data?.diffCount} 平账率=${run.json?.data?.matchRate}%`);

// 8. 对账报告 + 导出
const taskNo = run.json?.data?.taskNo;
const report = await api('GET', `/api/admin/reconcile/tasks/${taskNo}`, null, auth);
ok('对账报告', report.json?.code === 0 && !!report.json?.data?.taskNo, `差异类型数=${report.json?.data?.diffBreakdown?.length ?? 0}`);

const exportRes = await fetch(`${BASE}/api/admin/reconcile/tasks/${taskNo}/export`, { headers: auth });
const buf = Buffer.from(await exportRes.arrayBuffer());
ok('导出 Excel 报告', exportRes.status === 200 && buf.length > 1000, `${buf.length} bytes`);

// 9. 仪表盘
const dash = await api('GET', '/api/admin/dashboard', null, auth);
ok('监控概览', dash.json?.code === 0, `今日订单=${dash.json?.data?.today?.orderCount}`);

console.log('\n=== 冒烟测试完成 ===\n');
