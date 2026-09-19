<template>
  <div>
    <div class="pc-stat-grid">
      <div class="pc-stat">
        <div class="label">今日订单数</div>
        <div class="value">{{ data.today?.orderCount ?? '-' }}</div>
      </div>
      <div class="pc-stat">
        <div class="label">今日成功笔数</div>
        <div class="value ok">{{ data.today?.successCount ?? '-' }}</div>
      </div>
      <div class="pc-stat">
        <div class="label">今日成功金额(元)</div>
        <div class="value ok">{{ data.today?.successAmount ?? '-' }}</div>
      </div>
      <div class="pc-stat">
        <div class="label">支付成功率</div>
        <div class="value">{{ data.today?.successRate ?? '-' }}%</div>
      </div>
      <div class="pc-stat">
        <div class="label">待处理对账差异</div>
        <div class="value" :class="{ danger: data.pendingDiffCount > 0 }">{{ data.pendingDiffCount ?? '-' }}</div>
      </div>
      <div class="pc-stat">
        <div class="label">通知失败/死信</div>
        <div class="value" :class="{ warn: data.failedNotifyCount > 0 }">{{ data.failedNotifyCount ?? '-' }}</div>
      </div>
    </div>

    <div class="pc-card">
      <div style="font-weight: 600; margin-bottom: 12px">近 7 日交易趋势</div>
      <el-table :data="data.trend || []" size="small" border>
        <el-table-column prop="date" label="日期" width="140" />
        <el-table-column prop="total" label="订单数" />
        <el-table-column prop="success" label="成功数" />
        <el-table-column label="成功率">
          <template #default="{ row }">
            {{ row.total ? ((row.success / row.total) * 100).toFixed(2) : '0.00' }}%
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const data = ref({ today: {}, trend: [] });

onMounted(async () => {
  try {
    data.value = await api.dashboard();
  } catch (e) {
    /* 静默 */
  }
});
</script>
