<template>
  <section class="section">
    <div class="container prose">
      <span class="eyebrow">接入文档</span>
      <h1 style="font-size: clamp(24px, 3vw, 34px); margin: 0 0 14px">接入指引</h1>
      <p>
        所有开放接口均为 <code>POST + JSON over HTTPS</code>，业务系统按本文档实现签名即可接入，
        <strong>无需安装任何依赖包</strong>。若使用 Node.js，可直接下载单文件 SDK。
      </p>

      <h2>1. 获取密钥</h2>
      <p>
        商户入驻审核通过后（或由管理员在「业务系统」创建应用），获得 <code>AppId</code> 与
        <code>AppSecret</code>（Secret 仅展示一次）。同时可在应用配置里设置
        <strong>异步通知地址</strong>与 <strong>IP 白名单</strong>。
      </p>

      <h2>2. 接口清单</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>接口</th>
              <th>路径</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>下单</td>
              <td><code>POST /api/v1/open/pay/create</code></td>
              <td>幂等：同一 merchantOrderNo 返回同一订单</td>
            </tr>
            <tr>
              <td>查单</td>
              <td><code>POST /api/v1/open/pay/query</code></td>
              <td>payOrderNo 或 merchantOrderNo 二选一</td>
            </tr>
            <tr>
              <td>关单</td>
              <td><code>POST /api/v1/open/pay/close</code></td>
              <td>关闭未支付订单</td>
            </tr>
            <tr>
              <td>退款</td>
              <td><code>POST /api/v1/open/refund/create</code></td>
              <td>全额 / 部分退款，幂等键 merchantRefundNo</td>
            </tr>
            <tr>
              <td>查退款</td>
              <td><code>POST /api/v1/open/refund/query</code></td>
              <td>refundNo 或 merchantRefundNo 二选一</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>3. 请求头与签名</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Header</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>X-App-Id</code></td>
              <td>应用 AppId</td>
            </tr>
            <tr>
              <td><code>X-Timestamp</code></td>
              <td>秒级时间戳，与服务端偏差不超过 300 秒</td>
            </tr>
            <tr>
              <td><code>X-Nonce</code></td>
              <td>随机串，10 分钟内不可重复（防重放）</td>
            </tr>
            <tr>
              <td><code>X-Sign</code></td>
              <td>签名（小写 hex）</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>待签串（method 与 path 参与签名，避免请求被重放到其它接口）：</p>
      <pre class="code">待签串 = [ appId, timestamp, nonce, METHOD(大写), path, sha256Hex(原始请求体) ].join('\n')
签名    = HMAC_SHA256(key = AppSecret, msg = 待签串).toLowerCase()</pre>

      <div class="notice">
        签名失败的三个高频原因：① 参与签名的是<strong>最终发出的原始 body 字符串</strong>，不要 parse 后再
        stringify；② <code>path</code> 必须与实际请求路径完全一致（含 <code>/api/v1/open/</code> 前缀）；
        ③ 签名结果必须是<strong>小写</strong> hex。
      </div>

      <div class="code-tabs">
        <button
          v-for="l in langs"
          :key="l.key"
          type="button"
          class="code-tab"
          :class="{ 'is-active': lang === l.key }"
          @click="lang = l.key"
        >
          {{ l.label }}
        </button>
      </div>
      <pre class="code">{{ snippets[lang] }}</pre>
      <div class="sdk-actions">
        <button class="btn btn--ghost" type="button" @click="copyCurrent">
          {{ copied ? '已复制到剪贴板' : '复制当前示例' }}
        </button>
      </div>

      <h2>4. 发起下单</h2>
      <pre class="code">curl -X POST {{ apiBase }}/api/v1/open/pay/create \
  -H 'Content-Type: application/json' \
  -H 'X-App-Id: app_xxxxxxxx' \
  -H 'X-Timestamp: 1789840000' \
  -H 'X-Nonce: a1b2c3d4e5f6a7b8c9d0e1f' \
  -H 'X-Sign: &lt;小写 hex&gt;' \
  -d '{"appId":"app_xxxxxxxx","merchantOrderNo":"ORDER_20260920_001","amount":"128.50","subject":"会员年卡","tradeType":"NATIVE"}'</pre>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>appId</code></td>
              <td>是</td>
              <td>与请求头 X-App-Id 一致</td>
            </tr>
            <tr>
              <td><code>merchantOrderNo</code></td>
              <td>是</td>
              <td>业务订单号（幂等键）</td>
            </tr>
            <tr>
              <td><code>amount</code></td>
              <td>是</td>
              <td>金额，单位元，<strong>字符串</strong>最多两位小数，如 "128.50"</td>
            </tr>
            <tr>
              <td><code>subject</code></td>
              <td>是</td>
              <td>商品标题</td>
            </tr>
            <tr>
              <td><code>channel</code></td>
              <td>否</td>
              <td>wechat / alipay，不传由支付中心分配</td>
            </tr>
            <tr>
              <td><code>tradeType</code></td>
              <td>否</td>
              <td>JSAPI / NATIVE / APP / MINI / PAGE</td>
            </tr>
            <tr>
              <td><code>openId</code></td>
              <td>否</td>
              <td>JSAPI / 小程序支付必填</td>
            </tr>
            <tr>
              <td><code>notifyUrl</code></td>
              <td>否</td>
              <td>覆盖应用默认通知地址</td>
            </tr>
            <tr>
              <td><code>returnUrl</code> / <code>extra</code></td>
              <td>否</td>
              <td>支付后跳转地址 / 透传字段（通知原样返回）</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        成功响应 <code>code = 0</code>，<code>data.payParams</code> 按渠道不同：微信 JSAPI 返回
        <code>prepayId / paySign</code> 等可直接调起支付的参数；NATIVE 返回 <code>codeUrl</code>；支付宝
        PAGE 与 Mock 返回 <code>payUrl</code>。
      </p>

      <h2>5. 接收异步通知</h2>
      <p>
        支付 / 退款结果通过 <code>notifyUrl</code> 异步推送，指数退避重试：1s / 5s / 30s / 5min / 30min / 2h /
        6h，超限进入死信队列可在后台人工重投。业务系统须按 <code>merchantOrderNo</code> 做幂等处理，并在落库前验签：
      </p>
      <pre class="code">待签串 = [ appId, timestamp, nonce, sha256Hex(原始 body 字符串) ].join('\n')
校验    = HMAC_SHA256(AppSecret, 待签串).toLowerCase() === X-Pay-Sign

通知请求头：X-Pay-App-Id / X-Pay-Timestamp / X-Pay-Nonce / X-Pay-Sign / X-Pay-Trace-Id</pre>
      <p>业务处理完成后返回 <code>{"code":0}</code>；返回非 0 或超时均会触发重试。</p>

      <h2>6. SDK 下载（多语言）</h2>
      <p>
        各语言 SDK 均为<strong>单文件、零第三方依赖</strong>，下载后直接放进项目即可调用下单 / 查单 / 关单 /
        退款 / 通知验签。
      </p>
      <div class="sdk-actions">
        <a
          v-for="s in sdks"
          :key="s.file"
          class="btn"
          :class="s.primary ? 'btn--primary' : 'btn--ghost'"
          :href="'/sdk/' + s.file"
          download
        >
          {{ s.label }}
        </a>
        <a class="btn btn--ghost" :href="site.docsUrl" target="_blank" rel="noopener">
          Swagger 接口文档
        </a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>语言</th>
              <th>文件</th>
              <th>环境要求</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Node.js</td>
              <td><code>pay-sdk-node.js</code></td>
              <td>Node 18+（自带 fetch），无依赖</td>
            </tr>
            <tr>
              <td>Java</td>
              <td><code>PayClient.java</code></td>
              <td>JDK 11+，无依赖（HttpClient + 内置 JSON）</td>
            </tr>
            <tr>
              <td>PHP</td>
              <td><code>PayClient.php</code></td>
              <td>PHP 7.4+，仅需 curl 扩展</td>
            </tr>
            <tr>
              <td>Python</td>
              <td><code>pay_client.py</code></td>
              <td>Python 3.8+，无依赖（urllib）</td>
            </tr>
            <tr>
              <td>Go</td>
              <td><code>payclient.go</code></td>
              <td>Go 1.18+，无依赖（net/http）</td>
            </tr>
          </tbody>
        </table>
      </div>
      <pre class="code">const { createPayClient } = require('./pay-sdk-node.js');

const client = createPayClient({ baseUrl: '{{ apiBase }}', appId, appSecret });
const order = await client.createOrder({
  merchantOrderNo: 'ORDER_20260920_001',
  amount: '128.50',
  subject: '会员年卡',
  tradeType: 'NATIVE',
});
// 通知验签：rawBody 必须是未经 parse 的原始字符串
client.verifyNotify({ headers: req.headers, rawBody });</pre>

      <h2>7. 常见错误码</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>code</th>
              <th>含义</th>
              <th>处理建议</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2003</td>
              <td>缺少签名参数</td>
              <td>检查四个 X- 请求头是否齐全</td>
            </tr>
            <tr>
              <td>2004</td>
              <td>签名校验失败</td>
              <td>核对待签串顺序、path、原始 body、小写 hex</td>
            </tr>
            <tr>
              <td>2005 / 1006</td>
              <td>时间戳不合法 / 请求已过期</td>
              <td>服务器时间校准（NTP），使用秒级时间戳</td>
            </tr>
            <tr>
              <td>2006</td>
              <td>nonce 重放</td>
              <td>每次请求生成新的随机 nonce</td>
            </tr>
            <tr>
              <td>2007</td>
              <td>来源 IP 不在白名单</td>
              <td>在后台应用配置里补充出口 IP</td>
            </tr>
            <tr>
              <td>3008</td>
              <td>幂等键冲突</td>
              <td>同一 merchantOrderNo 的参数必须与首次一致</td>
            </tr>
            <tr>
              <td>4003</td>
              <td>退款金额超出可退金额</td>
              <td>先查单确认可退余额</td>
            </tr>
            <tr>
              <td>1002</td>
              <td>系统繁忙</td>
              <td>携带响应中的 traceId 联系技术支持</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>8. 沙箱联调</h2>
      <p>
        开发阶段使用内置 Mock 渠道与模拟收银台，无需真实商户号即可跑通「下单 → 支付 → 回调 → 查询 →
        退款」全链路；切生产只需管理员切换渠道配置，业务系统代码零改动。
      </p>

      <div class="notice" style="margin-top: 26px">
        完整字段定义、响应结构与在线调试：<a :href="site.docsUrl" target="_blank" rel="noopener">
          {{ site.docsUrl }}
        </a>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { site } from '../site.config';

const apiBase = computed(() => site.docsUrl.replace(/\/docs\/?$/, ''));

const sdks = [
  { label: '下载 Node.js SDK', file: 'pay-sdk-node.js', primary: true },
  { label: '下载 Java SDK', file: 'PayClient.java' },
  { label: '下载 PHP SDK', file: 'PayClient.php' },
  { label: '下载 Python SDK', file: 'pay_client.py' },
  { label: '下载 Go SDK', file: 'payclient.go' },
  { label: '接入说明 README', file: 'README.md' },
];

const langs = [
  { key: 'node', label: 'Node.js' },
  { key: 'java', label: 'Java' },
  { key: 'php', label: 'PHP' },
  { key: 'python', label: 'Python' },
  { key: 'go', label: 'Go' },
];
const lang = ref('node');
const copied = ref(false);

const snippets = {
  node: `const crypto = require('crypto');

/** body 必须是最终发送出去的原始字符串 */
function signRequest(appId, appSecret, method, path, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const content = [appId, timestamp, nonce, method.toUpperCase(), path, bodyHash].join('\\n');
  const sign = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return { 'X-App-Id': appId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign };
}

const body = JSON.stringify(payload);
const headers = signRequest(appId, appSecret, 'POST', '/api/v1/open/pay/create', body);`,

  java: `import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

public final class PaySign {
  static String hex(byte[] data) {
    StringBuilder sb = new StringBuilder();
    for (byte b : data) sb.append(String.format(Locale.ROOT, "%02x", b));
    return sb.toString();
  }

  static String sha256Hex(String s) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
  }

  /** body 必须是最终发送出去的原始字符串 */
  public static String sign(String appId, String secret, String method, String path, String body)
      throws Exception {
    String ts = String.valueOf(System.currentTimeMillis() / 1000);
    String nonce = UUID.randomUUID().toString().replace("-", "").substring(0, 24);
    String content = String.join("\\n", appId, ts, nonce, method.toUpperCase(), path, sha256Hex(body));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return hex(mac.doFinal(content.getBytes(StandardCharsets.UTF_8)));
  }
}
// 请求头：X-App-Id / X-Timestamp(ts) / X-Nonce(nonce) / X-Sign(sign)`,

  php: `<?php
/** $body 必须是最终发送出去的原始字符串 */
function paySign(string $appId, string $secret, string $method, string $path, string $body): array
{
    $ts = (string) time();
    $nonce = bin2hex(random_bytes(12));
    $bodyHash = hash('sha256', $body);
    $content = implode("\\n", [$appId, $ts, $nonce, strtoupper($method), $path, $bodyHash]);

    return [
        'X-App-Id' => $appId,
        'X-Timestamp' => $ts,
        'X-Nonce' => $nonce,
        'X-Sign' => hash_hmac('sha256', $content, $secret),
    ];
}

$body = json_encode($payload, JSON_UNESCAPED_UNICODE);
$headers = paySign($appId, $appSecret, 'POST', '/api/v1/open/pay/create', $body);`,

  python: `import hashlib, hmac, json, secrets, time


def pay_sign(app_id: str, secret: str, method: str, path: str, body: str) -> dict:
    """body 必须是最终发送出去的原始字符串"""
    ts = str(int(time.time()))
    nonce = secrets.token_hex(12)
    body_hash = hashlib.sha256(body.encode('utf-8')).hexdigest()
    content = '\\n'.join([app_id, ts, nonce, method.upper(), path, body_hash])
    return {
        'X-App-Id': app_id,
        'X-Timestamp': ts,
        'X-Nonce': nonce,
        'X-Sign': hmac.new(secret.encode(), content.encode(), hashlib.sha256).hexdigest(),
    }


body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
headers = pay_sign(app_id, app_secret, 'POST', '/api/v1/open/pay/create', body)`,

  go: `package pay

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// body 必须是最终发送出去的原始字符串
func PaySign(appID, secret, method, path, body string) map[string]string {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	nonce := hex.EncodeToString(buf)

	sum := sha256.Sum256([]byte(body))
	content := strings.Join([]string{
		appID, ts, nonce, strings.ToUpper(method), path, hex.EncodeToString(sum[:]),
	}, "\\n")

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(content))
	return map[string]string{
		"X-App-Id": appID, "X-Timestamp": ts, "X-Nonce": nonce,
		"X-Sign": hex.EncodeToString(mac.Sum(nil)),
	}
}`,
};

async function copyCurrent() {
  try {
    await navigator.clipboard.writeText(snippets[lang.value]);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}
</script>
