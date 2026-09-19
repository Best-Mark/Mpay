<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-input v-model="q.operator" placeholder="操作人" clearable style="width: 140px" />
      <el-select v-model="q.module" placeholder="模块" clearable style="width: 140px">
        <el-option label="支付 payment" value="payment" />
        <el-option label="退款 refund" value="refund" />
        <el-option label="对账 reconcile" value="reconcile" />
        <el-option label="渠道 channel" value="channel" />
        <el-option label="业务系统 merchant" value="merchant" />
        <el-option label="通知 notify" value="notify" />
        <el-option label="后台 admin" value="admin" />
      </el-select>
      <el-input v-model="q.keyword" placeholder="关键字" clearable style="width: 180px" />
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
      <el-table-column prop="createdAt" label="时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="operator" label="操作人" width="120" />
      <el-table-column prop="operatorType" label="来源" width="80" />
      <el-table-column prop="module" label="模块" width="100" />
      <el-table-column prop="action" label="动作" width="130" />
      <el-table-column prop="targetId" label="对象" width="200" show-overflow-tooltip />
      <el-table-column prop="detail" label="内容" min-width="240" show-overflow-tooltip />
      <el-table-column prop="result" label="结果" width="80">
        <template #default="{ row }">
          <el-tag :type="row.result === 'SUCCESS' ? 'success' : 'danger'" size="small">{{ row.result }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="showDetail(row)">详情</el-button>
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

    <el-drawer v-model="detailVisible" title="操作详情" size="45%">
      <el-descriptions :column="1" border v-if="current">
        <el-descriptions-item label="操作人">{{ current.operator }}（{{ current.operatorType }}）</el-descriptions-item>
        <el-descriptions-item label="模块/动作">{{ current.module }} / {{ current.action }}</el-descriptions-item>
        <el-descriptions-item label="内容">{{ current.detail }}</el-descriptions-item>
        <el-descriptions-item label="IP">{{ current.ip }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 12px; font-weight: 600">payload</div>
      <pre class="pc-mono" style="white-space: pre-wrap; word-break: break-all; margin-top: 8px">
{{ current?.payload ? JSON.stringify(current.payload, null, 2) : '无' }}</pre>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const q = reactive({ operator: '', module: '', keyword: '' });
const range = ref(null);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const detailVisible = ref(false);
const current = ref(null);

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-');

async function load() {
  loading.value = true;
  try {
    const res = await api.logs({
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
  Object.assign(q, { operator: '', module: '', keyword: '' });
  range.value = null;
  page.value = 1;
  load();
}

function showDetail(row) {
  current.value = row;
  detailVisible.value = true;
}

onMounted(load);
</script>
