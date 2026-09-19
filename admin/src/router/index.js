import { createRouter, createWebHashHistory } from 'vue-router';
import { isLogin } from '../utils/auth';

const routes = [
  { path: '/login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '概览', icon: '📊' } },
      { path: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单查询', icon: '🧾' } },
      { path: 'refunds', component: () => import('../views/Refunds.vue'), meta: { title: '退款管理', icon: '↩️' } },
      { path: 'reconcile', component: () => import('../views/Reconcile.vue'), meta: { title: '对账中心', icon: '🧮' } },
      { path: 'merchants', component: () => import('../views/Merchants.vue'), meta: { title: '业务系统', icon: '🏢' } },
      { path: 'channels', component: () => import('../views/Channels.vue'), meta: { title: '渠道配置', icon: '🔌' } },
      { path: 'notifies', component: () => import('../views/Notifies.vue'), meta: { title: '通知任务', icon: '📮' } },
      { path: 'logs', component: () => import('../views/Logs.vue'), meta: { title: '操作日志', icon: '📝' } },
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  if (!to.meta.public && !isLogin()) return '/login';
  return true;
});

export default router;
