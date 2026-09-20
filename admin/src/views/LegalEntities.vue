<template>
  <div class="pc-card">
    <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
      <div>
        <strong>主体是收款合规的基础维度</strong>：一个商户号只能归属一个法人主体，业务系统只能路由到<strong>同主体</strong>的商户号。
      </div>
      <div style="margin-top: 4px">
        跨主体收款属无证二次清算（二清），路由层会硬拒绝 —— 不是靠配置时小心，而是配错了直接下单失败。
        虚拟充值 / 预付费 / 游戏属高风险类目，务必单独进件、单独商户号，避免被风控时连坐。
      </div>
    </el-alert>

    <div class="pc-toolbar">
      <el-input v-model="q.keyword" placeholder="搜索主体名称 / 信用代码" clearable style="width: 240px" @keyup.enter="load" />
      <el-button type="primary" @click="load">查询</el-button>
      <el-button type="success" @click="openCreate">新增主体</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="name" label="主体名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="unifiedCode" label="统一社会信用代码" width="200" />
      <el-table-column prop="contact" label="联系人" width="120" />
      <el-table-column prop="appCount" label="业务系统" width="90" align="right" />
      <el-table-column prop="channelCount" label="渠道配置" width="90" align="right" />
      <el-table-column prop="enabled" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑法人主体' : '新增法人主体'" width="520px">
      <el-form :model="form" label-width="130px">
        <el-form-item label="主体名称" required>
          <el-input v-model="form.name" placeholder="营业执照上的公司全称" />
        </el-form-item>
        <el-form-item label="统一社会信用代码">
          <el-input v-model="form.unifiedCode" placeholder="18 位，选填但建议填写" />
        </el-form-item>
        <el-form-item label="联系人 / 法人">
          <el-input v-model="form.contact" placeholder="选填" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="如：主营线下零售" />
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import dayjs from 'dayjs';

const q = reactive({ keyword: '' });
const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(null);

const form = reactive({ name: '', unifiedCode: '', contact: '', remark: '', enabled: true });

const fmt = (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-');

async function load() {
  loading.value = true;
  try {
    list.value = await api.legalEntities(q.keyword || undefined);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { name: '', unifiedCode: '', contact: '', remark: '', enabled: true });
  dialogVisible.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    unifiedCode: row.unifiedCode || '',
    contact: row.contact || '',
    remark: row.remark || '',
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写主体名称');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await api.updateLegalEntity(editing.value.id, form);
      ElMessage.success('已保存');
    } else {
      await api.createLegalEntity(form);
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
    await api.updateLegalEntity(row.id, { enabled: !row.enabled });
    ElMessage.success('已更新');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除主体「${row.name}」？若其下仍有业务系统或渠道配置，会拒绝删除。`,
      '删除法人主体',
      { type: 'warning' },
    );
    await api.deleteLegalEntity(row.id);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    if (e.message) ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
