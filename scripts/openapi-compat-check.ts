/**
 * 开放接口向前兼容门禁
 *
 * 目的：把「业务系统接一次 SDK 就永久可用」从口头承诺变成可执行的检查。
 * 接进 CI / 发布流程：npm run compat:check
 *
 * 检查项：
 *  1. 基线中的路径、订单响应字段、payInfo 形态在代码中仍然存在（只增不减）
 *  2. payInfo 归一化对已知渠道形态的映射不漂移（形态语义变了会让老 SDK 渲染错）
 *
 * 运行：npm run compat:check（依赖 ts-node，无需额外安装测试框架）
 */
import * as fs from 'fs';
import * as path from 'path';
import { OPEN_API_PATHS, ORDER_RESPONSE_FIELDS, PAY_INFO_TYPES, OPEN_API_VERSION } from '../src/modules/payment/openapi-contract';
import { normalizePayInfo } from '../src/modules/channel/channel.types';

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'docs', 'openapi', 'v1-baseline.json');

const errors: string[] = [];
const added: string[] = [];
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

function diffList(name: string, baseline: string[], current: string[]) {
  const missing = baseline.filter((x) => !current.includes(x));
  const fresh = current.filter((x) => !baseline.includes(x));
  if (missing.length) errors.push(`${name} 出现删除/改名（破坏向前兼容）：${missing.join(', ')}`);
  else ok(`${name}：基线 ${baseline.length} 项全部保留`);
  if (fresh.length) {
    added.push(`${name} 新增：${fresh.join(', ')}`);
    console.log(`  + ${name} 新增 ${fresh.length} 项：${fresh.join(', ')}`);
  }
}

function main() {
  console.log(`开放接口向前兼容检查（v${OPEN_API_VERSION}）`);

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  if (baseline.apiVersion !== OPEN_API_VERSION) {
    errors.push(`基线 apiVersion=${baseline.apiVersion} 与代码 ${OPEN_API_VERSION} 不一致`);
  }

  // 1. 契约只增不减
  diffList('接口路径', baseline.paths, [...OPEN_API_PATHS]);
  diffList('订单响应字段', baseline.orderFields, [...ORDER_RESPONSE_FIELDS]);
  diffList('payInfo 形态', baseline.payInfoTypes, [...PAY_INFO_TYPES]);

  // 2. 路径在源码中真实存在（防止有人改了 @Controller / @Post 前缀）
  const declaredPaths = (file: string) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const prefix = /@Controller\(['"]([^'"]+)['"]\)/.exec(src)?.[1] || '';
    const routes = Array.from(src.matchAll(/@Post\(['"]([^'"]*)['"]\)/g)).map((m) => m[1]);
    return routes.map((r) => `/${prefix}/${r}`.replace(/\/{2,}/g, '/'));
  };
  const declared = [
    ...declaredPaths('src/modules/payment/payment.controller.ts'),
    ...declaredPaths('src/modules/refund/refund.controller.ts'),
  ];
  for (const p of OPEN_API_PATHS) {
    if (!declared.includes(p)) errors.push(`源码中找不到路径 ${p}（是否被改名或删除？）`);
  }
  ok(`接口路径在 controller 源码中均存在（${OPEN_API_PATHS.length} 条）`);

  // 3. payInfo 形态映射回归（新增渠道不能改变已有形态语义）
  const cases: { name: string; tradeType: string; payParams: any; expect: string }[] = [
    { name: '微信 NATIVE', tradeType: 'NATIVE', payParams: { tradeType: 'NATIVE', codeUrl: 'weixin://a' }, expect: 'qrcode' },
    { name: '微信 JSAPI', tradeType: 'JSAPI', payParams: { tradeType: 'JSAPI', prepayId: 'p1', appId: 'wx1' }, expect: 'jsapi' },
    { name: '支付宝 PC', tradeType: 'PC', payParams: { tradeType: 'PC', payUrl: 'https://a' }, expect: 'redirect' },
    { name: '银联前台', tradeType: 'PC', payParams: { tradeType: 'PC', payUrl: 'https://u', fields: { a: '1' } }, expect: 'form' },
    { name: '银联扫码', tradeType: 'NATIVE', payParams: { tradeType: 'NATIVE', qrCode: 'tn' }, expect: 'qrcode' },
    { name: 'App 支付', tradeType: 'APP', payParams: { tradeType: 'APP', tn: 't' }, expect: 'app' },
    { name: '条码付', tradeType: 'FACE_TO_FACE', payParams: { tradeType: 'FACE_TO_FACE' }, expect: 'none' },
    { name: '空参数（兜底）', tradeType: 'NATIVE', payParams: null, expect: 'none' },
  ];
  for (const c of cases) {
    const r = normalizePayInfo(c.tradeType, c.payParams);
    if (r.type !== c.expect) errors.push(`${c.name} 形态漂移：期望 ${c.expect}，实际 ${r.type}`);
    else ok(`${c.name} → ${r.type}`);
  }

  console.log('');
  if (errors.length) {
    console.error('向前兼容检查未通过：');
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }
  if (added.length) {
    console.log('检测到新增（属于允许的向前兼容变更，请确认后更新 docs/openapi/v1-baseline.json）：');
    added.forEach((a) => console.log(`  · ${a}`));
  }
  console.log('向前兼容检查通过：v1 契约未发生破坏性变更');
}

main();
