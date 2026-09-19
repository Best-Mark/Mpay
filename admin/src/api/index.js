import axios from 'axios';
import { getToken, clearAuth, getAdmin, getMerchantToken } from '../utils/auth';

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

  // ===== 系统设置（邮件 / 注册 / 告警 / 站点）=====
  settings: () => unwrap(http.get('/admin/settings')),
  saveSettings: (group, values) => unwrap(http.put('/admin/settings', { group, values })),
  testMail: (data) => unwrap(http.post('/admin/settings/mail/test', data)),
  testAlert: () => unwrap(http.post('/admin/settings/alert/test')),

  // ===== 图片上传（自动压缩转 WebP）=====
  uploadImage: (file, scene = 'image') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('scene', scene);
    return unwrap(http.post('/admin/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  uploads: (params) => unwrap(http.get('/admin/uploads', { params })),

  // ===== 商户入驻审核 =====
  merchantUsers: (params) => unwrap(http.get('/admin/merchant-users', { params })),
  approveMerchant: (id, data) => unwrap(http.post(`/admin/merchant-users/${id}/approve`, data || {})),
  rejectMerchant: (id, reason) => unwrap(http.post(`/admin/merchant-users/${id}/reject`, { reason })),
  setMerchantStatus: (id, status) => unwrap(http.put(`/admin/merchant-users/${id}/status`, { status })),
};

/** 商户端请求实例：走独立的商户 token，与后台管理员登录态隔离 */
const merchantHttp = axios.create({ baseURL: '/api', timeout: 30000 });
merchantHttp.interceptors.request.use((config) => {
  const token = getMerchantToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
merchantHttp.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(new Error(err.response?.data?.message || err.message || '请求失败')),
);

export const portalApi = {
  config: () => unwrap(merchantHttp.get('/portal/config')),
  sendCode: (email) => unwrap(merchantHttp.post('/portal/register/code', { email })),
  register: (data) => unwrap(merchantHttp.post('/portal/register', data)),
  login: (email, password) => unwrap(merchantHttp.post('/portal/login', { email, password })),
  me: () => unwrap(merchantHttp.get('/portal/me')),
  apps: () => unwrap(merchantHttp.get('/portal/apps')),
};

export { getAdmin };
