const TOKEN_KEY = 'pay_admin_token';
const USER_KEY = 'pay_admin_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
}

export function getAdmin() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  } catch {
    return {};
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLogin() {
  return !!getToken();
}

// ===== 商户端登录态（与后台管理员隔离）=====
const MERCHANT_TOKEN_KEY = 'pay_merchant_token';
const MERCHANT_USER_KEY = 'pay_merchant_user';

export function getMerchantToken() {
  return localStorage.getItem(MERCHANT_TOKEN_KEY) || '';
}

export function setMerchantAuth(token, user) {
  localStorage.setItem(MERCHANT_TOKEN_KEY, token || '');
  localStorage.setItem(MERCHANT_USER_KEY, JSON.stringify(user || {}));
}

export function getMerchant() {
  try {
    return JSON.parse(localStorage.getItem(MERCHANT_USER_KEY) || '{}');
  } catch {
    return {};
  }
}

export function clearMerchantAuth() {
  localStorage.removeItem(MERCHANT_TOKEN_KEY);
  localStorage.removeItem(MERCHANT_USER_KEY);
}
