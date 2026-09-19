import { createRouter, createWebHashHistory } from 'vue-router';
import { isLogin } from '../utils/auth';
import { api } from '../api';

const routes = [
  { path: '/install', component: () => import('../views/Install.vue'), meta: { public: true } },
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

/** 安装状态缓存：null 表示尚未查询过 */
let installState = null;

async function ensureInstallState() {
  if (installState === null) {
    try {
      installState = await api.installStatus();
    } catch {
      // 接口不可用（后端未就绪等）时按「已安装」处理，避免误挡正常访问
      installState = { installed: true };
    }
  }
  return installState;
}

router.beforeEach(async (to) => {
  const state = await ensureInstallState();
  if (!state.installed) return to.path === '/install' ? true : '/install';
  if (to.path === '/install') return '/login';
  if (!to.meta.public && !isLogin()) return '/login';
  return true;
});

export default router;
