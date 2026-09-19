<template>
  <!-- Hero -->
  <section class="hero">
    <div class="container hero__inner">
      <div>
        <span class="eyebrow" style="background: rgba(255,255,255,.14); color: #fff">
          聚合支付 · 统一收单 · 自动对账
        </span>
        <h1>{{ site.slogan }}</h1>
        <p>{{ site.intro }}</p>
        <div class="hero__actions">
          <a class="btn btn--primary" :href="site.registerUrl" target="_blank" rel="noopener">
            申请接入
          </a>
          <a class="btn btn--light" :href="site.docsUrl" target="_blank" rel="noopener">
            查看接口文档
          </a>
        </div>
        <div class="hero__channels">
          <span v-for="c in site.channels" :key="c.name">{{ c.name }} · {{ c.badge }}</span>
        </div>
      </div>

      <div class="hero__panel">
        <h4>一次下单请求，全渠道通用</h4>
        <pre class="code">POST /api/v1/pay/create
{
  "appId": "app_xxxxxxxx",
  "merchantOrderNo": "ORDER_20260920_001",
  "amount": 128.50,
  "subject": "会员年卡",
  "notifyUrl": "https://your-site.com/pay/notify",
  "scene": "MOCK"
}

→ 业务系统不感知渠道差异，
  微信 / 支付宝 / 沙箱由支付中心统一适配</pre>
      </div>
    </div>
  </section>

  <!-- 核心能力 -->
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">核心能力</span>
        <h2>把收款、退款、对账交给中台，业务只关心订单</h2>
        <p>渠道密钥集中托管在支付中心，业务系统零密钥、零渠道知识，新增渠道无需改动业务代码。</p>
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

  <!-- 支持渠道 -->
  <section class="section section--soft">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">支付渠道</span>
        <h2>主流渠道统一接入</h2>
        <p>微信支付 APIv3 证书验签、支付宝网关签名校验，账单自动解密解析，沙箱环境开箱即用。</p>
      </div>
      <div class="grid grid-4">
        <div v-for="c in site.channels" :key="c.name" class="card">
          <div style="display: flex; align-items: center; justify-content: space-between">
            <h3 style="margin: 0">{{ c.name }}</h3>
            <span class="tag">{{ c.badge }}</span>
          </div>
          <p style="margin-top: 10px">{{ c.desc }}</p>
        </div>
      </div>
    </div>
  </section>

  <!-- 数据亮点 -->
  <section class="section">
    <div class="container">
      <div class="metrics">
        <div v-for="m in site.metrics" :key="m.label" class="metric">
          <strong>{{ m.value }}</strong>
          <span>{{ m.label }}</span>
        </div>
      </div>
    </div>
  </section>

  <!-- 接入流程 -->
  <section class="section section--soft">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">接入流程</span>
        <h2>四步上线收款</h2>
        <p>从提交资料到正式收款，全程自助，沙箱环境可先行联调。</p>
      </div>
      <div class="grid grid-4 steps">
        <div v-for="(s, i) in site.steps" :key="s.title" class="step">
          <div class="step__no">{{ i + 1 }}</div>
          <h3 style="margin: 0 0 8px; font-size: 17px">{{ s.title }}</h3>
          <p style="margin: 0; color: var(--text-2); font-size: 15px">{{ s.desc }}</p>
        </div>
      </div>
      <div class="sdk-actions" style="justify-content: center">
        <router-link class="btn btn--ghost" to="/docs">查看接入文档</router-link>
        <a class="btn btn--primary" href="/sdk/pay-sdk-all.zip" download>
          下载 SDK 套件（ZIP）
        </a>
      </div>
    </div>
  </section>

  <!-- 场景 -->
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">适用场景</span>
        <h2>覆盖常见经营场景的收款诉求</h2>
        <p>电商、SaaS 订阅、教育培训、本地生活门店……统一订单号贯穿全链路。</p>
      </div>
      <div class="grid grid-2">
        <div v-for="s in site.scenarios" :key="s.name" class="card">
          <h3>{{ s.name }}</h3>
          <p style="margin-bottom: 10px">痛点：{{ s.pain }}</p>
          <p>方案：{{ s.value }}</p>
        </div>
      </div>
      <div style="text-align: center; margin-top: 34px">
        <router-link class="btn btn--ghost" to="/scenarios">查看全部场景</router-link>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="section section--soft">
    <div class="container" style="text-align: center">
      <h2 style="margin: 0 0 12px; font-size: clamp(22px, 3vw, 30px)">准备好接入了吗？</h2>
      <p style="color: var(--text-2); margin: 0 0 26px">
        提交入驻资料即可获取沙箱密钥，先联调、后上线，全程有据可查。
      </p>
      <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap">
        <a class="btn btn--primary" :href="site.registerUrl" target="_blank" rel="noopener">
          立即申请入驻
        </a>
        <router-link class="btn btn--ghost" to="/about">联系我们</router-link>
      </div>
    </div>
  </section>
</template>

<script setup>
import { site } from '../site.config';
</script>
