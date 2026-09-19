<template>
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">应用场景</span>
        <h2>从下单到对账，覆盖四类典型经营场景</h2>
        <p>统一订单号贯穿全链路，业务系统、财务、客服看到的是同一份数据。</p>
      </div>

      <div class="grid grid-2">
        <div v-for="s in site.scenarios" :key="s.name" class="card">
          <h3>{{ s.name }}</h3>
          <p style="margin-bottom: 8px"><strong style="color: var(--text)">痛点：</strong>{{ s.pain }}</p>
          <p><strong style="color: var(--text)">方案：</strong>{{ s.value }}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--soft">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">对账能力</span>
        <h2>每日自动对账，差异定位到单</h2>
        <p>拉取渠道账单 → 解析入库 → 双向核对 → 差异分类 → 报告 → Excel 导出，全流程无人值守。</p>
      </div>
      <div class="grid grid-3">
        <div class="card">
          <h3>自动拉单</h3>
          <p>每日定时下载微信、支付宝账单，加密账单自动解密解析后入库。</p>
        </div>
        <div class="card">
          <h3>双向核对</h3>
          <p>平台订单与渠道账单逐笔比对，长款、短款、金额不一致自动分类。</p>
        </div>
        <div class="card">
          <h3>差异处理</h3>
          <p>人工确认、补单、冲正、忽略四种处理方式，全部记录操作日志可追溯。</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container" style="text-align: center">
      <h2 style="margin: 0 0 12px">没有匹配到你的场景？</h2>
      <p style="color: var(--text-2); margin: 0 0 24px">
        支付中台能力可按业务形态调整，欢迎联系我们的技术顾问沟通方案。
      </p>
      <router-link class="btn btn--primary" to="/about">联系我们</router-link>
    </div>
  </section>
</template>

<script setup>
import { site } from '../site.config';
</script>
