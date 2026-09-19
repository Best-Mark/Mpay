<template>
  <section class="section">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">关于我们</span>
        <h2>{{ site.company.shortName }}</h2>
        <p>{{ site.intro }}</p>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>经营内容</h3>
          <p style="margin-top: 12px">{{ site.company.scope }}</p>
        </div>
        <div class="card">
          <h3>公司信息</h3>
          <ul class="list" style="margin-top: 12px">
            <li>公司名称：{{ site.company.name }}</li>
            <li>统一社会信用代码：{{ site.company.creditCode }}</li>
            <li>成立时间：{{ site.company.foundedAt }}</li>
            <li>所在地：{{ site.company.address }}</li>
            <li v-if="site.icp">网站备案：{{ site.icp }}</li>
            <li v-if="site.telecomLicense">增值电信业务许可：{{ site.telecomLicense }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--soft" id="contact">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">联系我们</span>
        <h2>商务合作与技术支持</h2>
        <p>渠道接入咨询、商户入驻、对账与告警配置，都可以通过以下方式联系到我们。</p>
      </div>

      <div class="grid grid-3">
        <div class="card">
          <h3>客服支持</h3>
          <p>邮箱：{{ site.contact.email }}</p>
          <p>电话：{{ site.contact.phone }}</p>
          <p>服务时间：{{ site.contact.workTime }}</p>
        </div>
        <div class="card">
          <h3>商务合作</h3>
          <p>合作邮箱：{{ site.contact.businessEmail }}</p>
          <p>合作方向：渠道接入、行业解决方案、定制化对账能力。</p>
        </div>
        <div class="card">
          <h3>商户入驻</h3>
          <p>自助提交资料，审核通过后自动获得 AppId / AppSecret 与沙箱环境。</p>
          <p style="margin-top: 14px">
            <a class="btn btn--primary" :href="site.contact.merchantEntry" target="_blank" rel="noopener">
              前往入驻
            </a>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { site } from '../site.config';
</script>
