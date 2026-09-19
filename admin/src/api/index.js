import axios from 'axios';
import { getToken, clearAuth, getAdmin } from '../utils/auth';

const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message || '请求失败';
    if (status === 401) {
      clearAuth();
      if (location.hash !== '#/login') location.href = '#/login';
    }
    return Promise.reject(new Error(msg));
  },
);

/** 后端统一响应为 { code, message, data }，此处直接取 data */
function unwrap(promise) {
  return promise.then((res) => {
    if (res && typeof res === 'object' && 'code' in res) {
      if (res.code !== 0) throw new Error(res.message || '业务异常');
      return res.data;
    }
    return res;
  });
}

export const api = {
  // ===== 登录与账号 =====
  login: (username, password) => unwrap(http.post('/admin/login', { username, password })),
  me: () => unwrap(http.get('/admin/me')),
  changePassword: (oldPassword, newPassword) =>
    unwrap(http.post('/admin/change-password', { oldPassword, newPassword })),

  // ===== 概览 =====
  dashboard: () => unwrap(http.get('/admin/dashboard')),

  // ===== 订单 =====
  orders: (params) => unwrap(http.get('/admin/orders', { params })),
  orderDetail: (payOrderNo) => unwrap(http.get(`/admin/orders/${payOrderNo}`)),
  closeOrder: (payOrderNo) => unwrap(http.post(`/admin/orders/${payOrderNo}/close`)),

  // ===== 退款 =====
  refunds: (params) => unwrap(http.get('/admin/refunds', { params })),
  retryRefund: (refundNo) => unwrap(http.post(`/admin/refunds/${refundNo}/retry`)),

  // ===== 业务系统 =====
  merchants: () => unwrap(http.get('/admin/merchants')),
  createMerchant: (data) => unwrap(http.post('/admin/merchants', data)),
  updateMerchant: (appId, data) => unwrap(http.put(`/admin/merchants/${appId}`, data)),
  resetSecret: (appId) => unwrap(http.post(`/admin/merchants/${appId}/reset-secret`)),

  // ===== 渠道配置 =====
  channels: () => unwrap(http.get('/admin/channels')),
  createChannel: (data) => unwrap(http.post('/admin/channels', data)),
  updateChannel: (id, data) => unwrap(http.put(`/admin/channels/${id}`, data)),

  // ===== 对账 =====
  runReconcile: (data) => unwrap(http.post('/admin/reconcile/run', data)),
  reconcileTasks: (params) => unwrap(http.get('/admin/reconcile/tasks', { params })),
  reconcileReport: (taskNo) => unwrap(http.get(`/admin/reconcile/tasks/${taskNo}`)),
  reconcileDiffs: (taskNo, params) => unwrap(http.get(`/admin/reconcile/tasks/${taskNo}/diffs`, { params })),
  allDiffs: (params) => unwrap(http.get('/admin/reconcile/diffs', { params })),
  handleDiff: (id, action, remark) =>
    unwrap(http.post(`/admin/reconcile/diffs/${id}/handle`, { action, remark })),
  exportUrl: (taskNo) => `/api/admin/reconcile/tasks/${taskNo}/export`,
  fetchBill: (data) => unwrap(http.post('/admin/reconcile/bills/fetch', data)),
  billStatus: (params) => unwrap(http.get('/admin/reconcile/bills', { params })),

  // ===== 通知 =====
  notifies: (params) => unwrap(http.get('/admin/notifies', { params })),
  redeliver: (id) => unwrap(http.post(`/admin/notifies/${id}/redeliver`)),

  // ===== 日志 =====
  logs: (params) => unwrap(http.get('/admin/logs', { params })),

  // ===== 安装向导（仅未安装时可用）=====
  installStatus: () => unwrap(http.get('/install/status')),
  installTestDb: (data, token) => unwrap(http.post('/install/test-db', { ...data, token })),
  installCheckPort: (port, token) => unwrap(http.post('/install/check-port', { port, token })),
  installCheckUrl: (url, token) => unwrap(http.post('/install/check-url', { url, token })),
  installApply: (data, token) => unwrap(http.post('/install/apply', { ...data, token })),
  installRestart: (restartToken, token) => unwrap(http.post('/install/restart', { restartToken, token })),
};

export { getAdmin };
