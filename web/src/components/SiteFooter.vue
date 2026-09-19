<template>
  <footer class="footer">
    <div class="container">
      <div class="footer__top">
        <div>
          <div class="footer__brand">{{ site.brand }}</div>
          <p style="margin: 0 0 14px">{{ site.slogan }}</p>
          <p style="margin: 0 0 4px">客服邮箱：{{ site.contact.email }}</p>
          <p style="margin: 0 0 4px">联系电话：{{ site.contact.phone }}</p>
          <p style="margin: 0">服务时间：{{ site.contact.workTime }}</p>
        </div>

        <div v-for="group in site.footerNav" :key="group.title">
          <h5>{{ group.title }}</h5>
          <ul>
            <li v-for="link in group.links" :key="link.text">
              <router-link :to="link.to">{{ link.text }}</router-link>
            </li>
          </ul>
        </div>
      </div>

      <div class="footer__bottom">
        <div>
          © {{ year }} {{ site.company.name }}　{{ site.icp }}
          <template v-if="site.policeRecord">　{{ site.policeRecord }}</template>
        </div>
        <div>
          <router-link to="/terms">服务协议</router-link>
          <span style="margin: 0 8px">·</span>
          <router-link to="/privacy">隐私政策</router-link>
          <span style="margin: 0 8px">·</span>
          <router-link to="/about">联系方式</router-link>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup>
import { site } from '../site.config';

const year = new Date().getFullYear();
</script>
