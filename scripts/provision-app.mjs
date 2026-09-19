/**
 * 批量为各业务项目开通「业务系统（AppId / AppSecret）」并输出对照表
 *
 * 用法：
 *   npm run provision:app -- --apps scripts/apps.json --base https://pay.7zan.com \
 *        --admin admin --password '***'
 *
 * 常用参数：
 *   --apps    <file>   项目清单（默认 scripts/apps.json，模板见 apps.example.json）
 *   --base    <url>    支付中心地址（默认 http://localhost:3000）
 *   --admin   <user>   超管账号（默认取 ADMIN_USER 环境变量，再默认 admin）
 *   --password <pwd>   超管密码（默认取 ADMIN_PASS 环境变量；不传会交互式提示不现实，请显式传）
 *   --update           同名应用已存在时，更新其通知地址/渠道/白名单（不换密钥）
 *   --force            同名也新建一套（用于同一项目再开一个环境）
 *   --out     <file>   把对照表（含密钥）写入文件；默认只打印，不落盘
 *   --dry              只校验清单，不实际创建
 *
 * ⚠️ AppSecret 明文只在创建响应中出现一次，请立刻存入公司密码库。
 */
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const APPS_FILE = path.resolve(arg('apps', 'scripts/apps.json'));
const ADMIN = arg('admin', process.env.ADMIN_USER || 'admin');
const PASSWORD = arg('password', process.env.ADMIN_PASS || '');
const UPDATE = has('update');
const FORCE = has('force');
const OUT = arg('out', '');
const DRY = has('dry');

async function api(method, urlPath, body, headers = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && json.code === undefined) {
    throw new Error(`${method} ${urlPath} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

function loadApps() {
  if (!fs.existsSync(APPS_FILE)) {
    console.error(`\n❌ 找不到项目清单：${APPS_FILE}`);
    console.error(`   请先复制模板：cp scripts/apps.example.json scripts/apps.json（PowerShell: Copy-Item）\n`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
  const apps = Array.isArray(raw) ? raw : raw.apps || [];
  if (!apps.length) {
    console.error('\n❌ 清单里没有 apps\n');
    process.exit(1);
  }
  const errors = [];
  apps.forEach((a, i) => {
    if (!a.name) errors.push(`#${i + 1} 缺少 name`);
    if (!a.payNotifyUrl) errors.push(`${a.name || `#${i + 1}`} 缺少 payNotifyUrl`);
    else if (!/^https?:\/\//.test(a.payNotifyUrl)) errors.push(`${a.name}: payNotifyUrl 必须是 http(s) 地址`);
    if (a.payNotifyUrl && !a.payNotifyUrl.startsWith('https://') && !a.name?.includes('测试')) {
      errors.push(`${a.name}: 生产环境通知地址建议用 HTTPS（当前 ${a.payNotifyUrl}）`);
    }
    if (a.refundNotifyUrl && !/^https?:\/\//.test(a.refundNotifyUrl)) errors.push(`${a.name}: refundNotifyUrl 非法`);
  });
  if (errors.length) {
    console.error('\n❌ 清单校验未通过：');
    errors.forEach((e) => console.error('   - ' + e));
    console.error('');
    process.exit(1);
  }
  return apps;
}

console.log(`\n=== 批量开通业务系统 → ${BASE} ===\n`);

const apps = loadApps();
console.log(`清单共 ${apps.length} 个项目${DRY ? '（--dry 仅校验，不创建）' : ''}\n`);

if (DRY) {
  apps.forEach((a) => console.log(`  ✓ ${a.name}  ${a.payNotifyUrl}  渠道=${(a.allowChannels || ['全部']).join('/')}`));
  console.log('\n校验通过，去掉 --dry 即可实际创建。\n');
  process.exit(0);
}

if (!PASSWORD) {
  console.error('❌ 缺少超管密码：用 --password 或环境变量 ADMIN_PASS 传入\n');
  process.exit(1);
}

// 1. 登录
const login = await api('POST', '/api/admin/login', { username: ADMIN, password: PASSWORD });
const token = login?.data?.token;
if (!token) {
  console.error(`❌ 管理员登录失败：${login?.message || '未知错误'}（创建业务系统需要 SUPER/OPERATOR 角色）\n`);
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };
console.log(`✓ 已登录：${ADMIN}\n`);

// 2. 现有应用（按 name 去重）
const existing = (await api('GET', '/api/admin/merchants', null, auth))?.data?.list || [];
const byName = new Map(existing.map((m) => [m.name, m]));

// 3. 逐个开通
const results = [];
for (const a of apps) {
  const found = byName.get(a.name);

  if (found && !FORCE && !UPDATE) {
    console.log(`• 跳过（已存在）：${a.name}  appId=${found.appId}`);
    results.push({ ...a, appId: found.appId, appSecret: '(已存在，密钥不回显；需重置请用后台或 --update 后手动重置)', status: '已存在' });
    continue;
  }

  if (found && UPDATE) {
    const r = await api('PUT', `/api/admin/merchants/${found.appId}`, {
      payNotifyUrl: a.payNotifyUrl,
      refundNotifyUrl: a.refundNotifyUrl || undefined,
      ipWhitelist: a.ipWhitelist || undefined,
      allowChannels: a.allowChannels,
      limitPerOrder: a.limitPerOrder ?? 0,
      remark: a.remark,
    }, auth);
    console.log(`${r?.code === 0 ? '✓ 已更新' : '❌ 更新失败'}：${a.name}  appId=${found.appId} ${r?.code !== 0 ? r?.message : ''}`);
    results.push({ ...a, appId: found.appId, appSecret: '(未变更)', status: r?.code === 0 ? '已更新' : '更新失败' });
    continue;
  }

  const r = await api('POST', '/api/admin/merchants', {
    name: a.name,
    payNotifyUrl: a.payNotifyUrl,
    refundNotifyUrl: a.refundNotifyUrl || undefined,
    ipWhitelist: a.ipWhitelist || undefined,
    allowChannels: a.allowChannels,
    limitPerOrder: a.limitPerOrder ?? 0,
    remark: a.remark,
  }, auth);

  if (r?.code !== 0 || !r?.data?.appId) {
    console.log(`❌ 创建失败：${a.name}  ${r?.message || ''}`);
    results.push({ ...a, appId: '-', appSecret: '-', status: '失败' });
    continue;
  }
  console.log(`✓ 已创建：${a.name}  appId=${r.data.appId}`);
  results.push({ ...a, appId: r.data.appId, appSecret: r.data.appSecret, status: '新建' });
}

// 4. 输出对照表
const md = [
  '',
  '## 业务系统对照表（含密钥，请存入密码库后删除本文件）',
  '',
  '| 项目 | 语言 | AppId | AppSecret | 支付通知地址 | 退款通知地址 | 渠道 | 状态 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.lang || '-'} | \`${r.appId}\` | \`${r.appSecret}\` | ${r.payNotifyUrl} | ${r.refundNotifyUrl || '同支付通知'} | ${(r.allowChannels || ['全部']).join('/')} | ${r.status} |`),
  '',
].join('\n');

console.log(md);

if (OUT) {
  fs.writeFileSync(path.resolve(OUT), md, 'utf8');
  console.log(`已写入：${OUT}\n⚠️ 该文件含明文密钥，交付后请删除或移入密码库。\n`);
} else {
  console.log('⚠️ AppSecret 明文仅出现这一次（未落盘）。请立即存入公司密码库；泄露后到后台「业务系统」重置即可，项目代码无需改动。\n');
}

const failed = results.filter((r) => r.status === '失败').length;
if (failed) process.exitCode = 1;
