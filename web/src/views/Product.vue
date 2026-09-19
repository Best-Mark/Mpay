<template>
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">核心功能</span>
        <h2>一个中台覆盖收款全链路</h2>
        <p>统一收单、统一退款、可靠通知、自动对账、渠道可插拔、金融级安全。</p>
      </div>

      <div class="grid grid-3">
        <div v-for="f in site.features" :key="f.title" class="card">
          <div style="font-size: 26px; margin-bottom: 10px">{{ f.icon }}</div>
          <h3>{{ f.title }}</h3>
          <p>{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--soft">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">接口能力</span>
        <h2>对外统一接口一览</h2>
        <p>所有开放接口使用 AppKey + HMAC-SHA256 签名鉴权，并带时间戳防重放。</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>接口</th>
              <th>方法</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="api in apis" :key="api.path">
              <td><code>{{ api.path }}</code></td>
              <td>{{ api.method }}</td>
              <td>{{ api.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="text-align: center; margin-top: 28px">
        <a class="btn btn--primary" :href="site.docsUrl" target="_blank" rel="noopener">
          打开完整接口文档
        </a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="grid grid-2">
        <div class="card">
          <h3>密钥与权限</h3>
          <ul class="list" style="margin-top: 12px">
            <li>每个业务系统独立 AppId / AppSecret，可单独停用与轮换</li>
            <li>支持 IP 白名单与接口权限控制</li>
            <li>渠道密钥 AES-256-GCM 加密落库，接口不回显明文</li>
          </ul>
        </div>
        <div class="card">
          <h3>稳定性保障</h3>
          <ul class="list" style="margin-top: 12px">
            <li>下单、退款全链路幂等，重复请求不会产生重复资金操作</li>
            <li>异步通知指数退避重试，进入死信后支持人工重投</li>
            <li>订单超时自动关单，避免长期悬挂占用库存</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { site } from '../site.config';

const apis = [
  { path: '/api/v1/pay/create', method: 'POST', desc: '统一下单，返回支付链接 / 支付参数' },
  { path: '/api/v1/pay/query', method: 'GET', desc: '按平台单号或业务单号查询支付状态' },
  { path: '/api/v1/pay/close', method: 'POST', desc: '关闭未支付订单' },
  { path: '/api/v1/refund/create', method: 'POST', desc: '申请全额或部分退款（幂等）' },
  { path: '/api/v1/refund/query', method: 'GET', desc: '查询退款状态' },
  { path: '/api/portal/register', method: 'POST', desc: '商户自助入驻（邮箱验证码）' },
];
</script>
