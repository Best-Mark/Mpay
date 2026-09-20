<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-input v-model="q.keyword" placeholder="搜索 AppId / 名称" clearable style="width: 220px" @keyup.enter="load" />
      <el-button type="primary" @click="load">查询</el-button>
      <el-button type="success" @click="openCreate">新增业务系统</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="appId" label="AppId" width="220" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="enabled" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="payNotifyUrl" label="支付通知地址" min-width="200" show-overflow-tooltip />
      <el-table-column prop="limitPerOrder" label="单笔限额" width="100" align="right">
        <template #default="{ row }">{{ Number(row.limitPerOrder) > 0 ? row.limitPerOrder : '不限' }}</template>
      </el-table-column>
      <el-table-column label="累计限额(日/月)" width="140" align="right">
        <template #default="{ row }">
          {{ Number(row.limitDaily) > 0 ? row.limitDaily : '不限' }} /
          {{ Number(row.limitMonthly) > 0 ? row.limitMonthly : '不限' }}
        </template>
      </el-table-column>
      <el-table-column label="主体 / 类目" min-width="180">
        <template #default="{ row }">
          <div :style="{ color: row.legalEntityId ? '' : '#e6a23c' }">{{ entityName(row.legalEntityId) }}</div>
          <el-tag v-if="row.category" size="small" :type="isRiskyCategory(row.category) ? 'danger' : 'info'">
            {{ bizCategoryLabel(row.category) }}
          </el-tag>
          <span v-else style="color: #e6a23c; font-size: 12px">未设置类目</span>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" @click="resetSecret(row)">重置密钥</el-button>
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pc-pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑业务系统' : '新增业务系统'" width="500px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：商城 App" />
        </el-form-item>
        <el-form-item label="支付通知地址" required>
          <el-input v-model="form.payNotifyUrl" placeholder="https://xxx/api/pay/notify" />
        </el-form-item>
        <el-form-item label="退款通知地址">
          <el-input v-model="form.refundNotifyUrl" placeholder="留空则使用支付通知地址" />
        </el-form-item>
        <el-form-item label="IP 白名单">
          <el-input v-model="form.ipWhitelist" placeholder="逗号分隔，留空不限制" />
        </el-form-item>
        <el-form-item label="允许渠道">
          <el-select v-model="form.allowChannels" multiple placeholder="留空=全部渠道" style="width: 100%">
            <el-option label="微信" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="银联 / 云闪付" value="unionpay" />
            <el-option label="模拟" value="mock" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属主体">
          <el-select v-model="form.legalEntityId" clearable filterable placeholder="未归属（不校验主体）" style="width: 100%">
            <el-option v-for="e in entityOptions" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
          <div style="color: #8492a6; font-size: 12px">只能使用同主体的商户号，跨主体会被路由层拒绝</div>
        </el-form-item>
        <el-form-item label="经营类目">
          <el-select v-model="form.category" clearable filterable placeholder="未设置" style="width: 100%">
            <el-option v-for="c in BIZ_CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
          <div style="color: #8492a6; font-size: 12px">须落在商户号已报备的类目内；高风险类目请单独配商户号</div>
        </el-form-item>
        <el-form-item label="单笔限额(元)">
          <el-input-number v-model="form.limitPerOrder" :min="0" :precision="2" style="width: 180px" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">0 = 不限</span>
        </el-form-item>
        <el-form-item label="单日累计(元)">
          <el-input-number v-model="form.limitDaily" :min="0" :precision="2" style="width: 180px" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">0 = 不限</span>
        </el-form-item>
        <el-form-item label="单月累计(元)">
          <el-input-number v-model="form.limitMonthly" :min="0" :precision="2" style="width: 180px" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">0 = 不限</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 密钥展示（仅返回一次） -->
    <el-dialog v-model="secretVisible" title="AppSecret（仅显示一次，请立即保存）" width="480px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
        密钥用于接口签名，泄露可被伪造支付请求。请妥善保管，关闭后无法再次查看。
      </el-alert>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="AppId">{{ secretAppId }}</el-descriptions-item>
        <el-descriptions-item label="AppSecret">{{ secretValue }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 12px; text-align: right">
        <el-button type="primary" size="small" @click="copy(secretAppId + '\n' + secretValue)">复制</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';
import { BIZ_CATEGORIES, bizCategoryLabel, isRiskyCategory } from '../constants/biz-category';

const q = reactive({ keyword: '' });
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(null);
const secretVisible = ref(false);
const secretValue = ref('');
const secretAppId = ref('');

const form = reactive({
  name: '',
  payNotifyUrl: '',
  refundNotifyUrl: '',
  ipWhitelist: '',
  legalEntityId: null,
  category: '',
  allowChannels: [],
  limitPerOrder: 0,
  limitDaily: 0,
  limitMonthly: 0,
  remark: '',
});

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-');

/** 法人主体下拉：业务系统只能路由到同主体的商户号 */
const entityOptions = ref([]);
async function loadEntities() {
  try {
    entityOptions.value = await api.legalEntities();
  } catch {
    entityOptions.value = [];
  }
}
function entityName(id) {
  if (!id) return '未归属';
  return entityOptions.value.find((e) => e.id === id)?.name || `#${id}`;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.merchants({ keyword: q.keyword, page: page.value, pageSize });
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    payNotifyUrl: '',
    refundNotifyUrl: '',
    ipWhitelist: '',
    allowChannels: [],
    limitPerOrder: 0,
    limitDaily: 0,
    limitMonthly: 0,
    legalEntityId: null,
    category: '',
    remark: '',
  });
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    payNotifyUrl: row.payNotifyUrl,
    refundNotifyUrl: row.refundNotifyUrl || '',
    ipWhitelist: row.ipWhitelist || '',
    allowChannels: row.allowChannels || [],
    limitPerOrder: Number(row.limitPerOrder) || 0,
    limitDaily: Number(row.limitDaily) || 0,
    limitMonthly: Number(row.limitMonthly) || 0,
    legalEntityId: row.legalEntityId ?? null,
    category: row.category || '',
    remark: row.remark || '',
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.name || !form.payNotifyUrl) {
    ElMessage.warning('请填写名称与支付通知地址');
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
        secretAppId.value = res.appId;
        secretValue.value = res.appSecret;
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
    secretAppId.value = res.appId;
    secretValue.value = res.appSecret;
    secretVisible.value = true;
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

async function toggle(row) {
  try {
    await api.updateMerchant(row.appId, { enabled: !row.enabled });
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

onMounted(async () => {
  await loadEntities();
  load();
});
</script>
