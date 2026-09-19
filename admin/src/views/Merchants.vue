<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-button type="primary" @click="openCreate">新增业务系统</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="appId" label="AppId" width="200" />
      <el-table-column prop="appName" label="名称" min-width="140" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="contact" label="联系人" width="100" />
      <el-table-column prop="notifyUrl" label="通知地址" min-width="200" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" @click="resetSecret(row)">重置密钥</el-button>
          <el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑业务系统' : '新增业务系统'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="form.appName" placeholder="如：商城 App" />
        </el-form-item>
        <el-form-item label="通知地址">
          <el-input v-model="form.notifyUrl" placeholder="https://xxx/api/pay/notify" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="form.contact" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.contactPhone" />
        </el-form-item>
        <template v-if="!editing">
          <el-form-item label="IP 白名单">
            <el-input v-model="form.ipWhitelist" placeholder="逗号分隔，留空不限制" />
          </el-form-item>
          <el-form-item label="允许渠道">
            <el-select v-model="form.allowedChannels" multiple placeholder="留空=全部渠道" style="width: 100%">
              <el-option label="微信" value="wechat" />
              <el-option label="支付宝" value="alipay" />
              <el-option label="模拟" value="mock" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 密钥展示（仅返回一次） -->
    <el-dialog v-model="secretVisible" title="AppSecret（仅显示一次，请立即保存）" width="460px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
        密钥用于接口签名，泄露可被伪造支付请求。请妥善保管，关闭后无法再次查看。
      </el-alert>
      <el-input :model-value="secretValue" readonly>
        <template #append>
          <el-button @click="copy(secretValue)">复制</el-button>
        </template>
      </el-input>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(null);
const secretVisible = ref(false);
const secretValue = ref('');

const form = reactive({ appName: '', notifyUrl: '', contact: '', contactPhone: '', ipWhitelist: '', allowedChannels: [] });

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-');

async function load() {
  loading.value = true;
  try {
    const res = await api.merchants();
    list.value = res.list || res || [];
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { appName: '', notifyUrl: '', contact: '', contactPhone: '', ipWhitelist: '', allowedChannels: [] });
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    appName: row.appName,
    notifyUrl: row.notifyUrl,
    contact: row.contact,
    contactPhone: row.contactPhone,
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.appName) {
    ElMessage.warning('请填写名称');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await api.updateMerchant(editing.value.appId, form);
      ElMessage.success('已保存');
    } else {
      const res = await api.createMerchant(form);
      ElMessage.success('创建成功');
      if (res.appSecret) {
        secretValue.value = `${res.appId}\n${res.appSecret}`;
        secretVisible.value = true;
      }
    }
    dialogVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function resetSecret(row) {
  try {
    await ElMessageBox.confirm(`重置后旧密钥立即失效，确认重置 ${row.appId} 的密钥？`, '高危操作', { type: 'warning' });
    const res = await api.resetSecret(row.appId);
    secretValue.value = res.appSecret;
    secretVisible.value = true;
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

async function toggle(row) {
  try {
    await api.updateMerchant(row.appId, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
    ElMessage.success('已更新');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(
    () => ElMessage.success('已复制'),
    () => ElMessage.warning('复制失败，请手动选择复制'),
  );
}

onMounted(load);
</script>
