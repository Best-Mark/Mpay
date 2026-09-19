import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './styles/main.css';
import { applySiteContent } from './site.config';

// 先加载服务器上的 site.content.json（可覆盖官网文案，改完刷新即生效），再挂载应用
applySiteContent().finally(() => {
  createApp(App).use(router).mount('#app');
});
