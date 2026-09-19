<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-input v-model="q.payOrderNo" placeholder="支付订单号" clearable style="width: 220px" />
      <el-input v-model="q.merchantOrderNo" placeholder="业务订单号" clearable style="width: 200px" />
      <el-input v-model="q.appId" placeholder="业务系统 AppId" clearable style="width: 200px" />
      <el-select v-model="q.channel" placeholder="渠道" clearable style="width: 130px">
        <el-option label="微信" value="wechat" />
        <el-option label="支付宝" value="alipay" />
        <el-option label="银联 / 云闪付" value="unionpay" />
        <el-option label="模拟" value="mock" />
      </el-select>
      <el-select v-model="q.status" placeholder="状态" clearable style="width: 140px">
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

    <el-alert v-if="summary" type="success" :closable="false" style="margin-bottom: 12px">
      当前筛选结果：成功 {{ summary.successCount }} 笔，合计 {{ summary.successAmount }} 元
    </el-alert>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="payOrderNo" label="支付订单号" width="200" />
      <el-table-column prop="merchantOrderNo" label="业务订单号" width="160" show-overflow-tooltip />
      <el-table-column prop="appId" label="业务系统" width="170" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="tradeType" label="交易类型" width="90" />
      <el-table-column prop="amount" label="金额(元)" width="100" align="right" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="channelTxnId" label="渠道交易号" width="180" show-overflow-tooltip />
      <el-table-column prop="notifyStatus" label="通知" width="90">
        <template #default="{ row }">
          <el-tag :type="row.notifyStatus === 'SUCCESS' ? 'success' : row.notifyStatus === 'DEAD' ? 'danger' : 'info'" size="small">
            {{ row.notifyStatus }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="paidAt" label="支付时间" width="170">
        <template #default="{ row }">{{ fmt(row.paidAt) }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="detail(row)">详情</el-button>
          <el-button
            v-if="row.channel === 'personal_qr' && row.status !== 'SUCCESS'"
            link
            type="success"
            @click="confirmPaid(row)"
          >
            确认到账
          </el-button>
          <el-button
            link
            type="danger"
            :disabled="row.status !== 'CREATED' && row.status !== 'PAYING'"
            @click="closeOrder(row)"
          >
            关闭
          </el-button>
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

    <el-drawer v-model="detailVisible" title="订单详情" size="50%">
      <el-descriptions :column="1" border v-if="current">
        <el-descriptions-item label="支付订单号">{{ current.payOrderNo }}</el-descriptions-item>
        <el-descriptions-item label="业务订单号">{{ current.merchantOrderNo }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ current.status }}</el-descriptions-item>
        <el-descriptions-item label="金额">{{ current.amount }} 元</el-descriptions-item>
        <el-descriptions-item label="已退金额">{{ current.refundedAmount }} 元</el-descriptions-item>
        <el-descriptions-item label="渠道交易号">{{ current.channelTxnId }}</el-descriptions-item>
        <el-descriptions-item label="支付者">{{ current.payerId }}</el-descriptions-item>
        <el-descriptions-item label="支付参数">
          <pre class="pc-mono">{{ JSON.stringify(current.payParams, null, 2) }}</pre>
        </el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 16px; font-weight: 600">退款记录</div>
      <el-table :data="current?.refunds || []" size="small" border style="margin-top: 8px">
        <el-table-column prop="refundNo" label="退款单号" width="190" />
        <el-table-column prop="amount" label="金额" width="100" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="reason" label="原因" show-overflow-tooltip />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const statuses = ['CREATED', 'PAYING', 'SUCCESS', 'CLOSED', 'REVOKED', 'FAILED', 'REFUNDING', 'REFUNDED'];

const q = reactive({ payOrderNo: '', merchantOrderNo: '', appId: '', channel: '', status: '' });
const range = ref(null);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const summary = ref(null);
const detailVisible = ref(false);
const current = ref(null);

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-');
const statusType = (s) =>
  ({ SUCCESS: 'success', CREATED: 'info', PAYING: 'warning', CLOSED: 'info', FAILED: 'danger', REVOKED: 'info', REFUNDING: 'warning', REFUNDED: 'warning' }[s] || 'info');

async function load() {
  loading.value = true;
  try {
    const res = await api.orders({
      ...q,
      startTime: range.value?.[0],
      endTime: range.value?.[1],
      page: page.value,
      pageSize,
    });
    list.value = res.list;
    total.value = res.total;
    summary.value = res.summary;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function reset() {
  Object.assign(q, { payOrderNo: '', merchantOrderNo: '', appId: '', channel: '', status: '' });
  range.value = null;
  page.value = 1;
  load();
}

async function detail(row) {
  current.value = await api.orderDetail(row.payOrderNo);
  detailVisible.value = true;
}

async function confirmPaid(row) {
  try {
    await ElMessageBox.prompt(
      `请在微信/支付宝账单中核对 ${row.amount} 元确实到账后再确认。可填付款账号/备注：`,
      '确认到账',
      { inputPlaceholder: '选填：付款账号尾号或备注', type: 'warning' },
    ).then(async ({ value }) => {
      await api.confirmPaid(row.payOrderNo, { remark: value || '' });
      ElMessage.success('已确认到账并通知业务系统');
      load();
    });
  } catch (e) {
    if (e.message && e.message !== 'cancel') ElMessage.error(e.message);
  }
}

async function closeOrder(row) {
  try {
    await ElMessageBox.confirm(`确认关闭订单 ${row.payOrderNo}？`, '提示', { type: 'warning' });
    await api.closeOrder(row.payOrderNo);
    ElMessage.success('已关闭');
    load();
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
