<template>
  <div class="pc-card">
    <div class="pc-toolbar">
      <el-input v-model="q.bizNo" placeholder="业务单号" clearable style="width: 200px" />
      <el-input v-model="q.appId" placeholder="业务系统 AppId" clearable style="width: 180px" />
      <el-select v-model="q.status" placeholder="状态" clearable style="width: 140px">
        <el-option label="待通知 PENDING" value="PENDING" />
        <el-option label="处理中 PROCESSING" value="PROCESSING" />
        <el-option label="成功 SUCCESS" value="SUCCESS" />
        <el-option label="失败 FAILED" value="FAILED" />
        <el-option label="死信 DEAD" value="DEAD" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="bizType" label="类型" width="90" />
      <el-table-column prop="bizNo" label="业务单号" width="200" show-overflow-tooltip />
      <el-table-column prop="appId" label="业务系统" width="160" show-overflow-tooltip />
      <el-table-column prop="notifyUrl" label="通知地址" min-width="200" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="retryCount" label="已重试" width="80" align="center" />
      <el-table-column prop="nextRetryAt" label="下次重试" width="170">
        <template #default="{ row }">{{ fmt(row.nextRetryAt) }}</template>
      </el-table-column>
      <el-table-column prop="lastStatusCode" label="HTTP状态" width="90" align="center" />
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :disabled="row.status === 'SUCCESS'" @click="redeliver(row)">重投</el-button>
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

    <el-drawer v-model="bodyVisible" title="最近一次请求/响应" size="45%">
      <pre class="pc-mono" style="white-space: pre-wrap; word-break: break-all">{{ currentBody || '暂无' }}</pre>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const q = reactive({ bizNo: '', appId: '', status: '' });
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const bodyVisible = ref(false);
const currentBody = ref('');

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-');
const statusType = (s) =>
  ({ SUCCESS: 'success', PENDING: 'info', PROCESSING: 'warning', FAILED: 'danger', DEAD: 'danger' }[s] || 'info');

async function load() {
  loading.value = true;
  try {
    const res = await api.notifies({ ...q, page: page.value, pageSize });
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function reset() {
  Object.assign(q, { bizNo: '', appId: '', status: '' });
  page.value = 1;
  load();
}

async function redeliver(row) {
  try {
    await api.redeliver(row.id);
    ElMessage.success('已重新投递');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
