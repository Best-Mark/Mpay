<template>
  <div class="pc-card">
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      个人收款码：没有商户号的用户上传自己的微信 / 支付宝收款码即可收款（渠道 <b>personal_qr</b>）。
      该渠道<b>没有渠道回调</b>，付款人在收银台页点「我已支付」后，需收款方到「订单查询」点<b>确认到账</b>；确认后业务系统收到的通知与正式渠道完全一致。
    </el-alert>

    <div class="pc-toolbar">
      <el-select v-model="appId" placeholder="选择业务系统" filterable style="width: 340px" @change="load">
        <el-option v-for="m in merchants" :key="m.appId" :label="`${m.name}（${m.appId}）`" :value="m.appId" />
      </el-select>
      <el-button type="primary" :disabled="!appId" @click="openCreate">上传收款码</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="type" label="类型" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="row.type === 'wechat' ? 'success' : row.type === 'alipay' ? 'primary' : 'info'">
            {{ typeName(row.type) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="收款账户备注" min-width="160" />
      <el-table-column label="收款码" width="120" align="center">
        <template #default="{ row }">
          <el-image :src="row.imageUrl" :preview-src-list="[row.imageUrl]" fit="contain" style="width: 56px; height: 56px" />
        </template>
      </el-table-column>
      <el-table-column prop="imageUrl" label="图片地址" min-width="200" show-overflow-tooltip />
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="170">
        <template #default="{ row }">{{ fmt(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <span style="color: #8492a6">该业务系统还没有收款码</span>
      </template>
    </el-table>

    <el-dialog v-model="dialogVisible" title="上传收款码" width="480px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="业务系统">
          <el-input :model-value="appId" disabled />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="微信" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="其它" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="账户备注">
          <el-input v-model="form.name" placeholder="如：张三-微信（留空自动生成）" />
        </el-form-item>
        <el-form-item label="收款码图片">
          <div style="display: flex; align-items: center; gap: 12px">
            <el-upload :http-request="doUpload" :show-file-list="false" accept="image/*">
              <el-button type="primary" :loading="uploading">选择图片</el-button>
            </el-upload>
            <el-image v-if="form.imageUrl" :src="form.imageUrl" fit="contain" style="width: 64px; height: 64px" />
            <span v-else style="color: #8492a6; font-size: 12px">未上传</span>
          </div>
          <div style="color: #8492a6; font-size: 12px; margin-top: 6px">
            上传的是<b>收款码</b>（微信「收付款→收款」/ 支付宝「收钱」），不是付款码；图片自动压缩转 WebP
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!form.imageUrl" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const merchants = ref([]);
const list = ref([]);
const appId = ref('');
const loading = ref(false);
const uploading = ref(false);
const dialogVisible = ref(false);
const form = ref({ type: 'wechat', name: '', imageUrl: '' });

function typeName(t) {
  return t === 'wechat' ? '微信' : t === 'alipay' ? '支付宝' : '其它';
}

function fmt(v) {
  if (!v) return '-';
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function load() {
  if (!appId.value) {
    list.value = [];
    return;
  }
  loading.value = true;
  try {
    list.value = await api.personalQr(appId.value);
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function doUpload({ file }) {
  uploading.value = true;
  try {
    const res = await api.uploadImage(file, 'image');
    form.value.imageUrl = res.url;
    ElMessage.success('上传成功');
  } catch (e) {
    ElMessage.error(e.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

function openCreate() {
  form.value = { type: 'wechat', name: '', imageUrl: '' };
  dialogVisible.value = true;
}

async function submit() {
  try {
    await api.createPersonalQr({
      appId: appId.value,
      type: form.value.type,
      name: form.value.name,
      imageUrl: form.value.imageUrl,
    });
    ElMessage.success('已保存');
    dialogVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  }
}

async function toggle(row) {
  try {
    await api.updatePersonalQr(row.id, { enabled: !row.enabled });
    ElMessage.success(row.enabled ? '已停用' : '已启用');
    load();
  } catch (e) {
    ElMessage.error(e.message || '操作失败');
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除收款码「${row.name}」？`, '提示', { type: 'warning' });
    await api.deletePersonalQr(row.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

onMounted(async () => {
  try {
    const res = await api.merchants();
    merchants.value = Array.isArray(res) ? res : res.list || [];
    if (merchants.value.length) {
      appId.value = merchants.value[0].appId;
      load();
    }
  } catch (e) {
    ElMessage.error(e.message || '加载业务系统失败');
  }
});
</script>
