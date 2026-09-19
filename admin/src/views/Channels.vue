<template>
  <div class="pc-card">
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      渠道密钥（私钥、APIv3 密钥等）加密存储于支付中心，业务系统永远接触不到。配置变更实时生效并留操作日志。
    </el-alert>

    <div class="pc-toolbar">
      <el-button type="primary" @click="openCreate">新增渠道配置</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="channel" label="渠道" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ channelName(row.channel) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="配置名称" min-width="150" />
      <el-table-column prop="mchId" label="商户号" width="170" />
      <el-table-column prop="scene" label="场景" width="90" />
      <el-table-column label="环境" width="90">
        <template #default="{ row }">
          <el-tag :type="row.isSandbox ? 'warning' : 'danger'" size="small">{{ row.isSandbox ? '沙箱' : '生产' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="70">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="密钥" width="90">
        <template #default="{ row }">
          <el-tag :type="row.hasPrivateKey ? 'success' : 'danger'" size="small">
            {{ row.hasPrivateKey ? '已配置' : '未配置' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="priority" label="优先级" width="80" align="center" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑渠道配置' : '新增渠道配置'" width="580px">
      <el-form :model="form" label-width="150px">
        <el-form-item label="渠道" required>
          <el-select v-model="form.channel" :disabled="!!editing" style="width: 100%">
            <el-option label="微信支付" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="模拟渠道" value="mock" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置名称" required>
          <el-input v-model="form.name" placeholder="如：微信-主商户" />
        </el-form-item>
        <el-form-item label="商户号 mchId" required>
          <el-input v-model="form.mchId" />
        </el-form-item>
        <el-form-item label="渠道应用 AppId">
          <el-input v-model="form.channelAppId" placeholder="公众号/小程序 AppID 或支付宝应用 APPID" />
        </el-form-item>
        <el-form-item label="场景 scene">
          <el-select v-model="form.scene" style="width: 100%">
            <el-option label="JSAPI（公众号/小程序）" value="JSAPI" />
            <el-option label="NATIVE（扫码）" value="NATIVE" />
            <el-option label="APP" value="APP" />
            <el-option label="H5" value="H5" />
          </el-select>
        </el-form-item>
        <el-form-item label="沙箱环境">
          <el-switch v-model="form.isSandbox" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :max="99" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">数字越大越优先</span>
        </el-form-item>
        <el-form-item label="证书序列号">
          <el-input v-model="form.certSerialNo" placeholder="微信 v3 商户证书序列号" />
        </el-form-item>
        <el-form-item label="签名类型">
          <el-select v-model="form.signType" style="width: 100%">
            <el-option label="RSA2（支付宝）" value="RSA2" />
            <el-option label="RSA（支付宝旧）" value="RSA" />
          </el-select>
        </el-form-item>
        <el-form-item label="商户私钥">
          <el-input v-model="form.privateKey" type="textarea" :rows="3" :placeholder="editing ? '留空表示不修改' : 'PEM 格式私钥内容'" />
        </el-form-item>
        <el-form-item label="平台证书/公钥">
          <el-input v-model="form.platformCert" type="textarea" :rows="3" :placeholder="editing ? '留空表示不修改' : '微信平台证书 / 支付宝公钥 PEM'" />
        </el-form-item>
        <el-form-item label="APIv3 密钥">
          <el-input v-model="form.apiV3Key" type="password" show-password :placeholder="editing ? '留空表示不修改' : '微信 v3 APIv3 密钥（32位）'" />
        </el-form-item>
        <el-form-item label="异步通知地址">
          <el-input v-model="form.notifyUrl" placeholder="留空使用系统默认" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
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
  scene: 'JSAPI',
  isSandbox: true,
  priority: 0,
  certSerialNo: '',
  signType: 'RSA2',
  privateKey: '',
  platformCert: '',
  apiV3Key: '',
  notifyUrl: '',
  remark: '',
});

const channelName = (c) => ({ wechat: '微信支付', alipay: '支付宝', mock: '模拟渠道', unionpay: '银联' }[c] || c);

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
    scene: 'JSAPI',
    isSandbox: true,
    priority: 0,
    certSerialNo: '',
    signType: 'RSA2',
    privateKey: '',
    platformCert: '',
    apiV3Key: '',
    notifyUrl: '',
    remark: '',
  });
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    channel: row.channel,
    name: row.name,
    mchId: row.mchId,
    channelAppId: row.channelAppId || '',
    scene: row.scene || 'JSAPI',
    isSandbox: row.isSandbox,
    priority: row.priority ?? 0,
    certSerialNo: row.certSerialNo || '',
    signType: row.signType || 'RSA2',
    privateKey: '',
    platformCert: '',
    apiV3Key: '',
    notifyUrl: row.notifyUrl || '',
    remark: row.remark || '',
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
    // 留空的密钥字段不下发，避免覆盖已存配置
    const payload = { ...form };
    for (const k of ['privateKey', 'platformCert', 'apiV3Key']) {
      if (!payload[k]) delete payload[k];
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
