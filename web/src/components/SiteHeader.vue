<template>
  <header class="header">
    <div class="container header__inner">
      <router-link to="/" class="logo">
        <span class="logo__mark">{{ site.brandEn.slice(0, 1) }}</span>
        <span>{{ site.brand }}</span>
      </router-link>

      <nav class="nav" :class="{ 'is-open': open }">
        <router-link to="/" @click="close">首页</router-link>
        <router-link to="/product" @click="close">核心功能</router-link>
        <router-link to="/scenarios" @click="close">应用场景</router-link>
        <router-link to="/docs" @click="close">接入文档</router-link>
        <router-link to="/about" @click="close">关于我们</router-link>
        <!-- 小屏按钮被隐藏，入口放菜单里 -->
        <a class="only-mobile" :href="site.consoleUrl" @click="close">登录</a>
        <a class="only-mobile" :href="site.registerUrl" @click="close">商户入驻</a>
        <a class="only-mobile" :href="site.docsUrl" target="_blank" rel="noopener" @click="close">
          接口文档
        </a>
      </nav>

      <div class="header__actions">
        <a class="btn btn--ghost" :href="site.consoleUrl">登录</a>
        <a class="btn btn--ghost" :href="site.docsUrl" target="_blank" rel="noopener">接口文档</a>
        <a class="btn btn--primary" :href="site.registerUrl">商户入驻</a>
        <button class="nav-toggle" type="button" aria-label="菜单" @click="open = !open">☰</button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref } from 'vue';
import { site } from '../site.config';

const open = ref(false);
const close = () => (open.value = false);
</script>
