<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <span class="logo">💳</span>
        <h2>统一支付中心</h2>
      </div>
      <p class="sub">管理后台</p>
      <el-form :model="form" size="large" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" show-password placeholder="密码" :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <p class="tip">默认账号 admin / Pay@admin123，首次登录后请立即修改密码</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { api } from '../api';
import { setAuth } from '../utils/auth';

const router = useRouter();
const form = ref({ username: '', password: '' });
const loading = ref(false);

async function submit() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await api.login(form.value.username, form.value.password);
    setAuth(res.token, res.user);
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2f6fed 0%, #1a3fa0 100%);
}

.login-card {
  width: 360px;
  background: #fff;
  border-radius: 12px;
  padding: 32px 28px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand h2 {
  margin: 0;
  font-size: 19px;
}

.logo {
  font-size: 26px;
}

.sub {
  color: #8492a6;
  font-size: 13px;
  margin: 4px 0 22px;
}

.submit {
  width: 100%;
}

.tip {
  margin-top: 16px;
  font-size: 12px;
  color: #a8b3c5;
  text-align: center;
}
</style>
