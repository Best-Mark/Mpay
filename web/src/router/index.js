import { createRouter, createWebHashHistory } from 'vue-router';
import { site } from '../site.config';

const routes = [
  { path: '/', component: () => import('../views/Home.vue'), meta: { title: '首页' } },
  { path: '/product', component: () => import('../views/Product.vue'), meta: { title: '核心功能' } },
  { path: '/scenarios', component: () => import('../views/Scenarios.vue'), meta: { title: '应用场景' } },
  { path: '/docs', component: () => import('../views/Docs.vue'), meta: { title: '接入文档' } },
  { path: '/about', component: () => import('../views/About.vue'), meta: { title: '关于我们' } },
  { path: '/terms', component: () => import('../views/Terms.vue'), meta: { title: '服务协议' } },
  { path: '/privacy', component: () => import('../views/Privacy.vue'), meta: { title: '隐私政策' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  // hash 路由：任意静态托管（根域名 / 子目录 / 对象存储）都无需服务端重写规则
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth' };
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const title = to.meta?.title;
  document.title = title ? `${title} · ${site.brand}` : `${site.brand} · ${site.slogan}`;
});

export default router;
