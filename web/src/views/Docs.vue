<template>
  <section class="section">
    <div class="container prose">
      <span class="eyebrow">接入文档</span>
      <h1 style="font-size: clamp(24px, 3vw, 34px); margin: 0 0 14px">接入指引</h1>
      <p>业务系统只需对接一次，即可使用全部已接入渠道。下面是最小接入路径。</p>

      <h2>1. 获取密钥</h2>
      <p>
        在商户入驻页提交资料并通过审核后，系统会分配 <code>AppId</code> 与
        <code>AppSecret</code>，可在商户后台查看与轮换，并配置 IP 白名单。
      </p>

      <h2>2. 构造签名</h2>
      <p>所有开放接口采用 AppKey + HMAC-SHA256 签名，并携带时间戳防重放：</p>
      <pre class="code">timestamp = Math.floor(Date.now() / 1000)
nonce     = randomString(16)
signStr   = `${appId}\n${timestamp}\n${nonce}\n${rawBody}`
signature = HMAC_SHA256(signStr, appSecret).hex()

请求头：
X-App-Id: app_xxxxxxxx
X-Timestamp: 1789840000
X-Nonce: a1b2c3d4e5f6g7h8
X-Signature: &lt;hex&gt;</pre>

      <h2>3. 发起下单</h2>
      <pre class="code">curl -X POST {{ apiBase }}/api/v1/pay/create \
  -H 'Content-Type: application/json' \
  -H 'X-App-Id: app_xxxxxxxx' \
  -H 'X-Timestamp: 1789840000' \
  -H 'X-Nonce: a1b2c3d4e5f6g7h8' \
  -H 'X-Signature: &lt;hex&gt;' \
  -d '{
    "merchantOrderNo": "ORDER_20260920_001",
    "amount": 128.50,
    "subject": "会员年卡",
    "notifyUrl": "https://your-site.com/pay/notify",
    "scene": "MOCK"
  }'</pre>

      <h2>4. 接收异步通知</h2>
      <p>
        支付 / 退款结果通过 <code>notifyUrl</code> 异步推送，采用指数退避重试：1s / 5s / 30s /
        5min / 30min / 2h / 6h，超过次数进入死信队列，可在后台人工重投。业务系统需按
        <code>merchantOrderNo</code> 做幂等处理。
      </p>

      <h2>5. 沙箱联调</h2>
      <p>
        开发阶段使用内置 Mock 渠道与模拟收银台，无需真实商户号即可跑通「下单 → 支付 → 回调 →
        查询 → 退款」全链路。
      </p>

      <div class="notice" style="margin-top: 26px">
        完整接口定义、字段说明与在线调试：<a :href="site.docsUrl" target="_blank" rel="noopener">
          {{ site.docsUrl }}
        </a>
        ；SDK 示例见仓库 <code>docs/sdk-node.js</code>。
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { site } from '../site.config';

const apiBase = computed(() => site.docsUrl.replace(/\/docs\/?$/, ''));
</script>
