<template>
  <div class="wrap">
    <!-- 未登录 -->
    <div v-if="!token" class="card login">
      <h2>商户后台</h2>
      <el-form label-width="70px" @keyup.enter="login">
        <el-form-item label="邮箱">
          <el-input v-model="loginForm.email" placeholder="注册时使用的邮箱" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="loginForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="login">登录</el-button>
          <el-button link @click="goRegister">还没有账号？申请入驻</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 已登录 -->
    <div v-else class="content">
      <div class="card">
        <div class="row">
          <div>
            <div class="title">{{ apps.companyName }}</div>
            <div class="sub">{{ apps.email }}</div>
          </div>
          <el-button link @click="logout">退出登录</el-button>
        </div>
      </div>

      <div v-if="!apps.apps.length" class="card empty">
        <el-empty description="暂无业务系统，请等待平台审核通过" />
      </div>

      <div v-for="app in apps.apps" :key="app.appId" class="card">
        <div class="row">
          <div class="title">{{ app.name }}</div>
          <el-tag size="small" :type="app.enabled ? 'success' : 'info'">{{ app.enabled ? '启用中' : '已停用' }}</el-tag>
        </div>
        <el-descriptions :column="1" border size="small" class="desc">
          <el-descriptions-item label="AppId"><code>{{ app.appId }}</code></el-descriptions-item>
          <el-descriptions-item label="AppSecret">
            <div class="secret-row">
              <code v-if="revealed[app.appId]">{{ app.appSecret }}</code>
              <code v-else>••••••••••••••••</code>
              <el-button link @click="revealed[app.appId] = !revealed[app.appId]">
                {{ revealed[app.appId] ? '隐藏' : '显示' }}
              </el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="支付通知地址">{{ app.payNotifyUrl || '-' }}</el-descriptions-item>
          <el-descriptions-item label="退款通知地址">{{ app.refundNotifyUrl || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div class="tip">AppSecret 请妥善保管，泄露后请联系平台在后台重置。</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { portalApi } from '../api';
import { getMerchantToken, setMerchantAuth, clearMerchantAuth, getMerchant } from '../utils/auth';

const token = ref(getMerchantToken());
const loading = ref(false);
const apps = ref({ companyName: '', email: '', apps: [] });
const revealed = reactive({});
const loginForm = reactive({ email: '', password: '' });
const me = computed(() => getMerchant());

onMounted(() => {
  if (token.value) loadApps();
});

async function login() {
  if (!loginForm.email || !loginForm.password) return ElMessage.warning('请填写邮箱与密码');
  loading.value = true;
  try {
    const r = await portalApi.login(loginForm.email, loginForm.password);
    setMerchantAuth(r.token, r.user);
    token.value = r.token;
    await loadApps();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadApps() {
  try {
    apps.value = await portalApi.apps();
  } catch (e) {
    // 登录态失效（如账号被停用）时清理本地凭证，回到登录页
    ElMessage.error(e.message);
    clearMerchantAuth();
    token.value = '';
  }
}

function logout() {
  clearMerchantAuth();
  token.value = '';
  apps.value = { companyName: '', email: '', apps: [] };
}

function goRegister() {
  location.hash = '#/register';
}
</script>

<style scoped>
.wrap { min-height: 100vh; background: #f0f2f5; padding: 40px 16px; }
.card { max-width: 720px; margin: 0 auto 16px; background: #fff; border-radius: 8px; padding: 22px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
.login h2 { font-size: 18px; margin-bottom: 18px; }
.row { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 16px; font-weight: 600; }
.sub { color: #909399; font-size: 13px; margin-top: 4px; }
.desc { margin-top: 14px; }
.secret-row { display: flex; align-items: center; gap: 10px; }
.tip { margin-top: 10px; color: #909399; font-size: 12px; }
code { background: #f5f7fa; padding: 2px 6px; border-radius: 4px; word-break: break-all; }
.empty { text-align: center; }
</style>
