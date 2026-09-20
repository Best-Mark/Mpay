<template>
  <div>
    <!-- =============== 对账报告列表 =============== -->
    <div class="pc-card" style="margin-bottom: 14px">
      <div class="pc-toolbar">
        <el-date-picker v-model="q.billDate" type="date" value-format="YYYY-MM-DD" placeholder="对账日期" style="width: 150px" />
        <el-select v-model="q.channel" placeholder="渠道" clearable style="width: 130px">
          <el-option label="全部渠道" value="ALL" />
          <el-option label="微信" value="wechat" />
          <el-option label="支付宝" value="alipay" />
          <el-option label="银联 / 云闪付" value="unionpay" />
          <el-option label="模拟" value="mock" />
        </el-select>
        <el-select v-model="q.status" placeholder="状态" clearable style="width: 130px">
          <el-option label="平账" value="SUCCESS" />
          <el-option label="有差异" value="PARTIAL" />
          <el-option label="执行中" value="RUNNING" />
          <el-option label="失败" value="FAILED" />
        </el-select>
        <el-button type="primary" @click="loadTasks">查询</el-button>
        <el-button type="success" @click="runVisible = true">▶ 手动对账</el-button>
        <el-button @click="openBillDialog">⬇ 账单补拉</el-button>
        <el-button @click="loadTasks">刷新</el-button>
      </div>

      <el-table :data="tasks" v-loading="loadingTasks" border size="small" stripe>
        <el-table-column prop="billDate" label="对账日期" width="110" />
        <el-table-column prop="channel" label="渠道" width="90" />
        <el-table-column prop="taskNo" label="批次号" width="190" show-overflow-tooltip />
        <el-table-column label="渠道侧" width="140" align="right">
          <template #default="{ row }">
            <div>{{ row.channelCount }} 笔</div>
            <div class="pc-mono">{{ row.channelAmount }}</div>
          </template>
        </el-table-column>
        <el-table-column label="中心侧" width="140" align="right">
          <template #default="{ row }">
            <div>{{ row.centerCount }} 笔</div>
            <div class="pc-mono">{{ row.centerAmount }}</div>
          </template>
        </el-table-column>
        <el-table-column label="平账" width="110" align="right">
          <template #default="{ row }">
            <div style="color: #67c23a">{{ row.matchedCount }} 笔</div>
            <div style="font-size: 12px; color: #8492a6">{{ row.matchRate }}%</div>
          </template>
        </el-table-column>
        <el-table-column label="差异" width="130" align="right">
          <template #default="{ row }">
            <div :style="{ color: Number(row.diffCount) > 0 ? '#f56c6c' : '#8492a6', fontWeight: 600 }">
              {{ row.diffCount }} 笔
            </div>
            <div class="pc-mono">{{ row.diffAmount }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="triggeredBy" label="执行人" width="90" />
        <el-table-column prop="finishedAt" label="完成时间" width="170">
          <template #default="{ row }">{{ fmt(row.finishedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openReport(row)">报告</el-button>
            <el-button link type="success" @click="exportExcel(row)">导出</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pc-pagination">
        <el-pagination
          v-model:current-page="taskPage"
          :page-size="taskPageSize"
          :total="taskTotal"
          layout="total, prev, pager, next"
          @current-change="loadTasks"
        />
      </div>
    </div>

    <!-- =============== 差异池（跨批次汇总） =============== -->
    <div class="pc-card">
      <div style="font-weight: 600; margin-bottom: 10px">
        待处理差异
        <el-tag v-if="diffTotal" type="danger" size="small" style="margin-left: 6px">{{ diffTotal }}</el-tag>
      </div>
      <div class="pc-toolbar">
        <el-select v-model="dq.handleStatus" placeholder="处理状态" clearable style="width: 140px" @change="loadDiffs">
          <el-option label="待处理" value="PENDING" />
          <el-option label="已确认平账" value="PROCESSED" />
          <el-option label="已补单" value="COMPENSATED" />
          <el-option label="已冲正" value="REVERSED" />
          <el-option label="已忽略" value="IGNORED" />
        </el-select>
        <el-select v-model="dq.diffType" placeholder="差异类型" clearable style="width: 170px" @change="loadDiffs">
          <el-option v-for="t in diffTypes" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-input v-model="dq.keyword" placeholder="订单号/渠道单号" clearable style="width: 200px" @keyup.enter="loadDiffs" />
        <el-button type="primary" @click="loadDiffs">查询</el-button>
      </div>

      <el-table :data="diffs" v-loading="loadingDiffs" border size="small" stripe>
        <el-table-column prop="billDate" label="账单日" width="100" />
        <el-table-column label="差异类型" width="120">
          <template #default="{ row }">
            <el-tag :type="row.severity === 'HIGH' ? 'danger' : 'warning'" size="small">{{ row.diffTypeLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="payOrderNo" label="支付订单号" width="190" show-overflow-tooltip />
        <el-table-column prop="merchantOrderNo" label="业务订单号" width="160" show-overflow-tooltip />
        <el-table-column prop="channel" label="渠道" width="80" />
        <el-table-column label="中心金额" width="100" align="right" prop="centerAmount" />
        <el-table-column label="渠道金额" width="100" align="right" prop="channelAmount" />
        <el-table-column label="差额" width="100" align="right">
          <template #default="{ row }">
            <span :style="{ color: Number(row.diffAmount) !== 0 ? '#f56c6c' : '#8492a6' }">{{ row.diffAmount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="handleStatus" label="处理状态" width="110">
          <template #default="{ row }">
            <el-tag :type="handleType(row.handleStatus)" size="small">{{ handleLabel(row.handleStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="handler" label="处理人" width="90" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.handleStatus !== 'PENDING'" @click="openHandle(row)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pc-pagination">
        <el-pagination
          v-model:current-page="diffPage"
          :page-size="diffPageSize"
          :total="diffTotal"
          layout="total, prev, pager, next"
          @current-change="loadDiffs"
        />
      </div>
    </div>

    <!-- =============== 手动触发对账 =============== -->
    <el-dialog v-model="runVisible" title="手动触发对账" width="420px">
      <el-form :model="runForm" label-width="90px">
        <el-form-item label="对账日期" required>
          <el-date-picker v-model="runForm.billDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="渠道">
          <el-select v-model="runForm.channel" style="width: 100%">
            <el-option label="全部渠道" value="ALL" />
            <el-option label="微信" value="wechat" />
            <el-option label="支付宝" value="alipay" />
            <el-option label="银联 / 云闪付" value="unionpay" />
            <el-option label="模拟" value="mock" />
          </el-select>
        </el-form-item>
        <el-form-item label="补拉账单">
          <el-switch v-model="runForm.autoFetch" />
          <span style="margin-left: 8px; font-size: 12px; color: #8492a6">无账单时自动从渠道下载</span>
        </el-form-item>
        <el-form-item label="强制重拉">
          <el-switch v-model="runForm.forceFetch" />
          <span style="margin-left: 8px; font-size: 12px; color: #8492a6">账单已存在也重新下载刷新</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="runVisible = false">取消</el-button>
        <el-button type="primary" :loading="running" @click="doRun">开始对账</el-button>
      </template>
    </el-dialog>

    <!-- =============== 渠道账单补拉 =============== -->
    <el-dialog v-model="billVisible" title="渠道账单补拉" width="580px">
      <el-form :model="billForm" label-width="100px">
        <el-form-item label="账单日期" required>
          <el-date-picker v-model="billForm.billDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="拉取范围">
          <el-select v-model="billForm.configId" clearable placeholder="全部商户号（全量遍历）" style="width: 100%">
            <el-option
              v-for="t in billTargets"
              :key="t.configId"
              :value="t.configId"
              :label="`${t.channel} / ${t.mchId}${t.name ? ' · ' + t.name : ''}`"
            />
          </el-select>
          <div style="font-size: 12px; color: #8492a6; line-height: 1.6; margin-top: 4px">
            留空 = 遍历全部渠道商户号逐个下载。同一渠道下挂了多个主体 / 类目的商户号时，
            只拉默认号会漏掉其余主体的账。
          </div>
        </el-form-item>
        <el-form-item label="强制重拉">
          <el-switch v-model="billForm.force" />
          <span style="margin-left: 8px; font-size: 12px; color: #8492a6">已有账单也重新下载（按唯一键覆盖，不会重复）</span>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="billResult"
        :type="billResult.failed ? 'warning' : 'success'"
        :closable="false"
        style="margin-top: 6px"
        :title="`成功 ${billResult.succeeded} 个商户号，跳过(已有) ${billResult.skipped || 0}，失败 ${billResult.failed}`"
      />
      <div v-if="billResult?.errors?.length" style="margin-top: 8px; font-size: 12px; color: #e6a23c">
        <div v-for="(e, i) in billResult.errors" :key="i">{{ e.channel }}/{{ e.mchId }}：{{ e.error }}</div>
      </div>

      <template #footer>
        <el-button @click="billVisible = false">关闭</el-button>
        <el-button type="primary" :loading="fetchingBill" @click="doFetchBills">开始拉取</el-button>
      </template>
    </el-dialog>

    <!-- =============== 对账报告 =============== -->
    <el-drawer v-model="reportVisible" :title="`对账报告 ${report?.taskNo || ''}`" size="72%">
      <template v-if="report">
        <div class="report-grid">
          <div class="report-item">
            <div class="label">对账日期 / 周期</div>
            <div class="value">{{ report.billDate }} / {{ report.periodType === 'DAILY' ? '日对账' : report.periodType }}</div>
          </div>
          <div class="report-item">
            <div class="label">渠道 / 业务</div>
            <div class="value">{{ report.channel === 'ALL' ? '全部渠道' : report.channel }} / {{ report.appId === 'ALL' ? '全部业务' : report.appId }}</div>
          </div>
          <div class="report-item">
            <div class="label">渠道侧</div>
            <div class="value">{{ report.channelCount }} 笔 / {{ report.channelAmount }} 元</div>
          </div>
          <div class="report-item">
            <div class="label">支付中心侧</div>
            <div class="value">{{ report.centerCount }} 笔 / {{ report.centerAmount }} 元</div>
          </div>
          <div class="report-item ok">
            <div class="label">平账</div>
            <div class="value">{{ report.matchedCount }} 笔（{{ report.matchRate }}%）</div>
          </div>
          <div class="report-item danger">
            <div class="label">差异</div>
            <div class="value">{{ report.diffCount }} 笔 / {{ report.diffAmount }} 元</div>
          </div>
          <div class="report-item">
            <div class="label">执行时间 / 耗时</div>
            <div class="value">{{ fmt(report.finishedAt) }}（{{ report.durationMs }}ms）</div>
          </div>
          <div class="report-item">
            <div class="label">执行人 / 触发方式</div>
            <div class="value">{{ report.triggeredBy }} / {{ report.triggerType }}</div>
          </div>
        </div>

        <div class="pc-toolbar" style="margin-top: 14px">
          <el-button type="success" @click="exportExcel(report)">⬇ 导出 Excel 报告</el-button>
        </div>

        <div style="font-weight: 600; margin: 10px 0 8px">差异类型分布</div>
        <el-table :data="report.diffBreakdown || []" size="small" border>
          <el-table-column prop="label" label="差异类型" width="180" />
          <el-table-column prop="count" label="笔数" width="100" align="right" />
          <el-table-column prop="amount" label="差异金额(元)" align="right" />
        </el-table>

        <div style="font-weight: 600; margin: 16px 0 8px">差异明细</div>
        <el-table :data="reportDiffs" size="small" border stripe>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'HIGH' ? 'danger' : 'warning'" size="small">{{ row.diffTypeLabel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="payOrderNo" label="支付订单号" width="180" show-overflow-tooltip />
          <el-table-column prop="merchantOrderNo" label="业务订单号" width="150" show-overflow-tooltip />
          <el-table-column prop="centerAmount" label="中心金额" width="95" align="right" />
          <el-table-column prop="channelAmount" label="渠道金额" width="95" align="right" />
          <el-table-column prop="diffAmount" label="差额" width="95" align="right" />
          <el-table-column prop="centerStatus" label="中心状态" width="95" />
          <el-table-column prop="channelStatus" label="渠道状态" width="95" />
          <el-table-column prop="handleStatus" label="处理状态" width="100">
            <template #default="{ row }">
              <el-tag :type="handleType(row.handleStatus)" size="small">{{ handleLabel(row.handleStatus) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- =============== 差异处理 =============== -->
    <el-dialog v-model="handleVisible" title="处理对账差异" width="480px">
      <template v-if="handling">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="差异类型">{{ handling.diffTypeLabel }}（{{ handling.severity === 'HIGH' ? '高危' : '中危' }}）</el-descriptions-item>
          <el-descriptions-item label="支付订单号">{{ handling.payOrderNo || '-' }}</el-descriptions-item>
          <el-descriptions-item label="中心 / 渠道金额">{{ handling.centerAmount ?? '-' }} / {{ handling.channelAmount ?? '-' }} 元</el-descriptions-item>
          <el-descriptions-item label="差额">{{ handling.diffAmount }} 元</el-descriptions-item>
        </el-descriptions>
        <el-form label-width="90px" style="margin-top: 14px">
          <el-form-item label="处理方式">
            <el-radio-group v-model="handleForm.action">
              <el-radio-button value="PROCESSED">确认平账</el-radio-button>
              <el-radio-button value="COMPENSATED">补单</el-radio-button>
              <el-radio-button value="REVERSED">冲正</el-radio-button>
              <el-radio-button value="IGNORED">忽略</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-alert
            v-if="handleForm.action === 'COMPENSATED'"
            type="warning"
            :closable="false"
            title="补单：渠道确认已收款，将把支付中心订单补记为已支付，并异步通知业务系统"
          />
          <el-alert
            v-else-if="handleForm.action === 'REVERSED'"
            type="error"
            :closable="false"
            title="冲正：渠道确认未收款，将把支付中心订单置为已关闭。此操作影响业务侧订单状态，请务必核实后执行"
          />
          <el-form-item label="备注" style="margin-top: 12px">
            <el-input v-model="handleForm.remark" type="textarea" :rows="2" placeholder="处理依据（如：已电话核实渠道客服）" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="handleVisible = false">取消</el-button>
        <el-button type="primary" :loading="handlingSubmit" @click="submitHandle">确认处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { getToken } from '../utils/auth';
import dayjs from 'dayjs';

const diffTypes = [
  { value: 'CHANNEL_ONLY', label: '长款（渠道有中心无）' },
  { value: 'CENTER_ONLY', label: '短款（中心有渠道无）' },
  { value: 'AMOUNT_DIFF', label: '金额不符' },
  { value: 'STATUS_DIFF', label: '状态不符' },
  { value: 'DUPLICATE', label: '重复支付' },
  { value: 'REFUND_DIFF', label: '退款差异' },
];

const q = reactive({ billDate: '', channel: '', status: '' });
const tasks = ref([]);
const taskTotal = ref(0);
const taskPage = ref(1);
const taskPageSize = 15;
const loadingTasks = ref(false);

const dq = reactive({ handleStatus: 'PENDING', diffType: '', keyword: '' });
const diffs = ref([]);
const diffTotal = ref(0);
const diffPage = ref(1);
const diffPageSize = 15;
const loadingDiffs = ref(false);

const runVisible = ref(false);
const running = ref(false);
const runForm = reactive({
  billDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
  channel: 'ALL',
  autoFetch: true,
  forceFetch: false,
});

const reportVisible = ref(false);
const report = ref(null);
const reportDiffs = ref([]);

const billVisible = ref(false);
const fetchingBill = ref(false);
const billTargets = ref([]);
const billResult = ref(null);
const billForm = reactive({
  billDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
  configId: null,
  force: false,
});

const handleVisible = ref(false);
const handling = ref(null);
const handlingSubmit = ref(false);
const handleForm = reactive({ action: 'PROCESSED', remark: '' });

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-');
const statusType = (s) => ({ SUCCESS: 'success', PARTIAL: 'warning', RUNNING: 'info', FAILED: 'danger' }[s] || 'info');
const statusLabel = (s) => ({ SUCCESS: '平账', PARTIAL: '有差异', RUNNING: '执行中', FAILED: '失败' }[s] || s);
const handleType = (s) => ({ PENDING: 'danger', PROCESSED: 'success', COMPENSATED: 'warning', REVERSED: 'warning', IGNORED: 'info' }[s] || 'info');
const handleLabel = (s) =>
  ({ PENDING: '待处理', PROCESSED: '已确认平账', COMPENSATED: '已补单', REVERSED: '已冲正', IGNORED: '已忽略' }[s] || s);

async function loadTasks() {
  loadingTasks.value = true;
  try {
    const res = await api.reconcileTasks({ ...q, page: taskPage.value, pageSize: taskPageSize });
    tasks.value = res.list;
    taskTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loadingTasks.value = false;
  }
}

async function loadDiffs() {
  loadingDiffs.value = true;
  try {
    const res = await api.allDiffs({ ...dq, page: diffPage.value, pageSize: diffPageSize });
    diffs.value = res.list;
    diffTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loadingDiffs.value = false;
  }
}

async function doRun() {
  if (!runForm.billDate) {
    ElMessage.warning('请选择对账日期');
    return;
  }
  running.value = true;
  try {
    await api.runReconcile({ ...runForm });
    ElMessage.success('对账完成');
    runVisible.value = false;
    taskPage.value = 1;
    diffPage.value = 1;
    await Promise.all([loadTasks(), loadDiffs()]);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    running.value = false;
  }
}

async function openBillDialog() {
  billResult.value = null;
  billVisible.value = true;
  try {
    billTargets.value = await api.billTargets();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function doFetchBills() {
  if (!billForm.billDate) {
    ElMessage.warning('请选择账单日期');
    return;
  }
  fetchingBill.value = true;
  try {
    if (billForm.configId) {
      const t = billTargets.value.find((x) => x.configId === billForm.configId);
      const r = await api.fetchBill({ channel: t.channel, billDate: billForm.billDate, configId: t.configId });
      billResult.value = { succeeded: 1, skipped: 0, failed: 0, results: [r], errors: [] };
    } else {
      billResult.value = await api.fetchAllBills({ billDate: billForm.billDate, force: billForm.force });
    }
    ElMessage.success(billResult.value.failed ? '拉取完成，部分商户号失败' : '账单拉取完成');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    fetchingBill.value = false;
  }
}

async function openReport(row) {
  report.value = await api.reconcileReport(row.taskNo);
  const res = await api.reconcileDiffs(row.taskNo, { pageSize: 100 });
  reportDiffs.value = res.list;
  reportVisible.value = true;
}

async function exportExcel(row) {
  try {
    const res = await fetch(api.exportUrl(row.taskNo), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `对账报告_${row.taskNo}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error(e.message || '导出失败');
  }
}

function openHandle(row) {
  handling.value = row;
  handleForm.action = row.diffType === 'CHANNEL_ONLY' ? 'COMPENSATED' : row.diffType === 'CENTER_ONLY' ? 'REVERSED' : 'PROCESSED';
  handleForm.remark = '';
  handleVisible.value = true;
}

async function submitHandle() {
  handlingSubmit.value = true;
  try {
    await api.handleDiff(handling.value.id, handleForm.action, handleForm.remark);
    ElMessage.success('处理完成，操作已留痕');
    handleVisible.value = false;
    diffPage.value = 1;
    await loadDiffs();
    if (reportVisible.value) loadTasks();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    handlingSubmit.value = false;
  }
}

onMounted(() => {
  loadTasks();
  loadDiffs();
});
</script>

<style scoped>
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.report-item {
  background: #f7f9fc;
  border-radius: 8px;
  padding: 12px 14px;
}

.report-item .label {
  color: #8492a6;
  font-size: 12px;
}

.report-item .value {
  font-weight: 600;
  margin-top: 4px;
  font-size: 14px;
}

.report-item.ok .value {
  color: #67c23a;
}

.report-item.danger .value {
  color: #f56c6c;
}

@media (max-width: 768px) {
  .report-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
