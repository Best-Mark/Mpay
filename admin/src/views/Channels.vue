<template>
  <div class="pc-card">
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      渠道密钥（API 证书、私钥等）加密存储于支付中心，业务系统永远接触不到。配置变更会实时生效并留操作日志。
    </el-alert>

    <div class="pc-toolbar">
      <el-button type="primary" @click="openCreate">新增渠道配置</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="channel" label="渠道" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ channelName(row.channel) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="配置名称" min-width="160" />
      <el-table-column prop="mchId" label="商户号" width="180" />
      <el-table-column prop="env" label="环境" width="90">
        <template #default="{ row }">
          <el-tag :type="row.env === 'PROD' ? 'danger' : 'warning'" size="small">{{ row.env }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="hasKeys" label="密钥" width="80">
        <template #default="{ row }">
          <el-tag :type="row.hasKeys ? 'success' : 'danger'" size="small">{{ row.hasKeys ? '已配置' : '未配置' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑渠道配置' : '新增渠道配置'" width="560px">
      <el-form :model="form" label-width="140px">
        <el-form-item label="渠道">
          <el-select v-model="form.channel" :disabled="!!editing" style="width: 100%">
            <el-option label="微信支付" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="模拟渠道" value="mock" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置名称">
          <el-input v-model="form.name" placeholder="如：微信-主商户" />
        </el-form-item>
        <el-form-item label="商户号 mchId">
          <el-input v-model="form.mchId" />
        </el-form-item>
        <el-form-item label="AppId(渠道侧)">
          <el-input v-model="form.channelAppId" placeholder="公众号/小程序 AppID 或支付宝应用 APPID" />
        </el-form-item>
        <el-form-item label="环境">
          <el-select v-model="form.env" style="width: 100%">
            <el-option label="生产 PROD" value="PROD" />
            <el-option label="沙箱 SANDBOX" value="SANDBOX" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :max="99" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">数字越小越优先</span>
        </el-form-item>
        <el-form-item label="异步通知地址">
          <el-input v-model="form.notifyUrl" placeholder="留空使用系统默认" />
        </el-form-item>
        <el-form-item label="密钥/证书(JSON)">
          <el-input
            v-model="form.secretsText"
            type="textarea"
            :rows="6"
            placeholder='JSON 格式，如：{"apiKeyV3":"xxx","serialNo":"xxx","privateKey":"-----BEGIN PRIVATE KEY-----..."}'
          />
          <div style="font-size: 12px; color: #8492a6; margin-top: 4px">
            编辑时留空表示不修改密钥。微信 v3 需 apiKeyV3/serialNo/privateKey/merchantCert；支付宝需 appId/privateKey/alipayPublicKey。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(null);
const form = reactive({
  channel: 'wechat',
  name: '',
  mchId: '',
  channelAppId: '',
  env: 'SANDBOX',
  priority: 0,
  notifyUrl: '',
  secretsText: '',
});

const channelName = (c) => ({ wechat: '微信支付', alipay: '支付宝', mock: '模拟渠道', unionpay: '银联', ecpay: '数字人民币' }[c] || c);

async function load() {
  loading.value = true;
  try {
    const res = await api.channels();
    list.value = res.list || res || [];
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    channel: 'wechat',
    name: '',
    mchId: '',
    channelAppId: '',
    env: 'SANDBOX',
    priority: 0,
    notifyUrl: '',
    secretsText: '',
  });
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    channel: row.channel,
    name: row.name,
    mchId: row.mchId,
    channelAppId: row.channelAppId,
    env: row.env || 'SANDBOX',
    priority: row.priority ?? 0,
    notifyUrl: row.notifyUrl || '',
    secretsText: '',
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.name || !form.mchId) {
    ElMessage.warning('请填写配置名称与商户号');
    return;
  }
  saving.value = true;
  try {
    const payload = { ...form };
    if (payload.secretsText?.trim()) {
      try {
        payload.secrets = JSON.parse(payload.secretsText);
      } catch {
        ElMessage.error('密钥必须是合法 JSON');
        return;
      }
    } else {
      payload.secrets = editing.value ? undefined : {};
    }
    if (editing.value) {
      await api.updateChannel(editing.value.id, payload);
      ElMessage.success('已保存');
    } else {
      await api.createChannel(payload);
      ElMessage.success('已创建');
    }
    dialogVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    await api.updateChannel(row.id, { enabled: !row.enabled });
    ElMessage.success('已更新');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
