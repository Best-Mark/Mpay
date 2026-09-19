<template>
  <div class="page">
    <el-card shadow="never">
      <div class="filters">
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="load">
          <el-option label="待审核" value="PENDING" />
          <el-option label="已通过" value="ACTIVE" />
          <el-option label="已驳回" value="REJECTED" />
          <el-option label="已停用" value="DISABLED" />
        </el-select>
        <el-input
          v-model="query.keyword"
          placeholder="邮箱 / 公司 / 联系人"
          clearable
          style="width: 240px"
          @keyup.enter="load"
          @clear="load"
        />
        <el-button type="primary" @click="load">查询</el-button>
        <span class="total">共 {{ total }} 条</span>
      </div>

      <el-table v-loading="loading" :data="list" border size="small">
        <el-table-column prop="companyName" label="公司/主体" min-width="160" />
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column prop="contactName" label="联系人" width="100" />
        <el-table-column prop="contactPhone" label="电话" width="130" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="业务系统" min-width="180">
          <template #default="{ row }">
            <span v-if="!row.apps.length" class="muted">未开通</span>
            <span v-for="a in row.apps" :key="a.appId" class="app">
              <code>{{ a.appId }}</code>
              <el-tag size="small" :type="a.enabled ? 'success' : 'info'">{{ a.enabled ? '启用' : '停用' }}</el-tag>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="申请时间" width="170">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PENDING' || row.status === 'REJECTED'" link type="primary" @click="openApprove(row)">
              通过
            </el-button>
            <el-button v-if="row.status === 'PENDING'" link type="danger" @click="openReject(row)">驳回</el-button>
            <el-button v-if="row.status === 'ACTIVE'" link @click="setStatus(row, 'DISABLED')">停用</el-button>
            <el-button v-if="row.status === 'DISABLED'" link type="success" @click="setStatus(row, 'ACTIVE')">启用</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :current-page="query.page"
          :page-size="query.pageSize"
          @current-change="(p) => { query.page = p; load(); }"
        />
      </div>
    </el-card>

    <!-- 审核通过 -->
    <el-dialog v-model="approveVisible" title="审核通过" width="520px">
      <el-form :model="approveForm" label-width="130px">
        <el-form-item label="支付通知地址" required>
          <el-input v-model="approveForm.payNotifyUrl" placeholder="业务系统接收支付结果的地址" />
          <div class="hint">商户注册时填写：{{ current.payNotifyUrlText || '（未填写）' }}</div>
        </el-form-item>
        <el-form-item label="退款通知地址">
          <el-input v-model="approveForm.refundNotifyUrl" />
        </el-form-item>
        <el-form-item label="单笔限额(元)">
          <el-input v-model="approveForm.limitPerOrder" placeholder="0 表示不限" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitApprove">确认通过</el-button>
      </template>
    </el-dialog>

    <!-- 驳回 -->
    <el-dialog v-model="rejectVisible" title="驳回申请" width="460px">
      <el-form label-width="80px">
        <el-form-item label="原因">
          <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="会随邮件告知申请人" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 开通结果（密钥只出现一次） -->
    <el-dialog v-model="secretVisible" title="业务系统已开通" width="560px">
      <el-alert type="warning" :closable="false" title="AppSecret 只显示这一次" description="请立刻复制保存并转交对接同学；系统不再明文展示，泄露可在「业务系统」页重置。" />
      <div class="secret-box">
        <div><span>AppId</span><code>{{ secret.appId }}</code></div>
        <div><span>AppSecret</span><code class="secret">{{ secret.appSecret }}</code></div>
      </div>
      <div class="secret-tip">若已配置邮件，密钥同时发送到了商户邮箱。</div>
      <template #footer>
        <el-button @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const submitting = ref(false);
const query = reactive({ status: '', keyword: '', page: 1, pageSize: 20 });

const approveVisible = ref(false);
const rejectVisible = ref(false);
const secretVisible = ref(false);
const approveForm = ref({ payNotifyUrl: '', refundNotifyUrl: '', limitPerOrder: '' });
const rejectReason = ref('');
const current = ref({});
const secret = ref({ appId: '', appSecret: '' });

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const r = await api.merchantUsers(query);
    list.value = r.list;
    total.value = r.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function statusLabel(s) {
  return ({ PENDING: '待审核', ACTIVE: '已通过', REJECTED: '已驳回', DISABLED: '已停用' })[s] || s;
}
function statusType(s) {
  return ({ PENDING: 'warning', ACTIVE: 'success', REJECTED: 'danger', DISABLED: 'info' })[s] || 'info';
}
function fmt(t) {
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
}

function openApprove(row) {
  current.value = row;
  approveForm.value = { payNotifyUrl: row.apps.length ? '' : '', refundNotifyUrl: '', limitPerOrder: '' };
  approveVisible.value = true;
}

async function submitApprove() {
  if (!approveForm.value.payNotifyUrl) return ElMessage.warning('请填写支付通知地址');
  submitting.value = true;
  try {
    const r = await api.approveMerchant(current.value.id, {
      payNotifyUrl: approveForm.value.payNotifyUrl,
      refundNotifyUrl: approveForm.value.refundNotifyUrl || undefined,
      limitPerOrder: Number(approveForm.value.limitPerOrder || 0),
    });
    approveVisible.value = false;
    if (r.appSecret) {
      secret.value = { appId: r.appId, appSecret: r.appSecret };
      secretVisible.value = true;
    } else {
      ElMessage.success('已通过（业务系统已重新启用）');
    }
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    submitting.value = false;
  }
}

function openReject(row) {
  current.value = row;
  rejectReason.value = '';
  rejectVisible.value = true;
}

async function submitReject() {
  submitting.value = true;
  try {
    await api.rejectMerchant(current.value.id, rejectReason.value || '未说明');
    rejectVisible.value = false;
    ElMessage.success('已驳回');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    submitting.value = false;
  }
}

async function setStatus(row, status) {
  try {
    await ElMessageBox.confirm(
      status === 'DISABLED' ? '停用后该商户的业务系统将立即无法下单，确认？' : '确认重新启用该商户？',
      '提示',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await api.setMerchantStatus(row.id, status);
    ElMessage.success('操作成功');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}
</script>

<style scoped>
.page { padding: 4px; }
.filters { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.total { margin-left: auto; color: #909399; font-size: 13px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
.muted { color: #c0c4cc; }
.app { display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; }
.hint { color: #909399; font-size: 12px; line-height: 1.6; }
.secret-box { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.secret-box span { display: inline-block; width: 78px; color: #606266; }
.secret-box code { background: #f5f7fa; padding: 4px 8px; border-radius: 4px; word-break: break-all; }
.secret-box .secret { color: #c0392b; }
.secret-tip { margin-top: 10px; color: #909399; font-size: 12px; }
</style>
