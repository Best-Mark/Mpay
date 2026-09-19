<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">💳</span>
        <span>统一支付中心</span>
      </div>
      <nav>
        <router-link
          v-for="item in menus"
          :key="item.path"
          class="menu-item"
          :class="{ active: isActive(item.path) }"
          :to="'/' + item.path"
        >
          <span class="icon">{{ item.meta.icon }}</span>
          <span>{{ item.meta.title }}</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">v1.0.0</div>
    </aside>

    <div class="main">
      <header class="header">
        <div class="title">{{ currentTitle }}</div>
        <div class="user">
          <el-dropdown @command="onCommand">
            <span class="user-btn">
              {{ admin.username || '未登录' }}
              <el-tag size="small" type="info">{{ roleLabel }}</el-tag>
              <span class="caret">▾</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="pwd">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      <div class="content">
        <router-view />
      </div>
    </div>

    <el-dialog v-model="pwdVisible" title="修改密码" width="360px">
      <el-form :model="pwdForm" label-width="80px">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="submitPwd">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getAdmin, clearAuth } from '../utils/auth';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const admin = ref(getAdmin());

const menus = router.options.routes.find((r) => r.path === '/').children;

const currentTitle = computed(() => route.meta?.title || '');
const isActive = (p) => route.path === '/' + p;
const roleLabel = computed(
  () => ({ SUPER: '超管', FINANCE: '财务', OPERATOR: '运营', VIEWER: '只读' })[admin.value.role] || '',
);

const pwdVisible = ref(false);
const pwdLoading = ref(false);
const pwdForm = ref({ oldPassword: '', newPassword: '' });

function onCommand(cmd) {
  if (cmd === 'pwd') {
    pwdForm.value = { oldPassword: '', newPassword: '' };
    pwdVisible.value = true;
  } else if (cmd === 'logout') {
    clearAuth();
    router.push('/login');
  }
}

async function submitPwd() {
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
    ElMessage.warning('请填写完整');
    return;
  }
  pwdLoading.value = true;
  try {
    await api.changePassword(pwdForm.value.oldPassword, pwdForm.value.newPassword);
    ElMessage.success('密码已修改，请重新登录');
    pwdVisible.value = false;
    clearAuth();
    router.push('/login');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    pwdLoading.value = false;
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 210px;
  background: #001529;
  color: #c0c8d4;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 16px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.logo {
  font-size: 20px;
}

nav {
  flex: 1;
  padding: 8px 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 18px;
  color: #c0c8d4;
  text-decoration: none;
  font-size: 14px;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.menu-item.active {
  background: #2f6fed;
  color: #fff;
}

.icon {
  width: 18px;
  text-align: center;
}

.sidebar-footer {
  padding: 12px 16px;
  font-size: 12px;
  color: #6b7480;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.header {
  height: 56px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  z-index: 2;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.user-btn {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  outline: none;
}

.caret {
  color: #8492a6;
}

.content {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
</style>
