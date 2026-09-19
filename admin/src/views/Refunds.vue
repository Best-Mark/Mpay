<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-input v-model="q.refundNo" placeholder="退款单号" clearable style="width: 200px" />
      <el-input v-model="q.payOrderNo" placeholder="支付订单号" clearable style="width: 200px" />
      <el-input v-model="q.appId" placeholder="业务系统 AppId" clearable style="width: 180px" />
      <el-select v-model="q.status" placeholder="状态" clearable style="width: 130px">
        <el-option v-for="s in statuses" :key="s" :label="s" :value="s" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="datetimerange"
        value-format="YYYY-MM-DD HH:mm:ss"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        style="width: 340px"
      />
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="refundNo" label="退款单号" width="200" />
      <el-table-column prop="payOrderNo" label="支付订单号" width="200" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="amount" label="退款金额(元)" width="110" align="right" />
      <el-table-column prop="reason" label="原因" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="notifyStatus" label="通知" width="90" />
      <el-table-column prop="createdAt" label="申请时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="finishedAt" label="完成时间" width="170">
        <template #default="{ row }">{{ fmt(row.finishedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :disabled="!canRetry(row)" @click="retry(row)">重试</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pc-pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next, jumper"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const statuses = ['CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CLOSED', 'ABNORMAL'];
const q = reactive({ refundNo: '', payOrderNo: '', appId: '', status: '' });
const range = ref(null);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-');
const statusType = (s) =>
  ({ SUCCESS: 'success', CREATED: 'info', PROCESSING: 'warning', FAILED: 'danger', ABNORMAL: 'danger', CLOSED: 'info' }[s] || 'info');
const canRetry = (r) => ['FAILED', 'ABNORMAL'].includes(r.status);

async function load() {
  loading.value = true;
  try {
    const res = await api.refunds({
      ...q,
      startTime: range.value?.[0],
      endTime: range.value?.[1],
      page: page.value,
      pageSize,
    });
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function reset() {
  Object.assign(q, { refundNo: '', payOrderNo: '', appId: '', status: '' });
  range.value = null;
  page.value = 1;
  load();
}

async function retry(row) {
  try {
    await ElMessageBox.confirm(`确认重试退款 ${row.refundNo}？`, '提示', { type: 'warning' });
    await api.retryRefund(row.refundNo);
    ElMessage.success('已提交重试');
    load();
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
