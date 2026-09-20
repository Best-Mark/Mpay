<template>
  <div class="pc-card">
    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
      渠道密钥（私钥、APIv3 密钥等）加密存储于支付中心，业务系统永远接触不到。配置变更实时生效并留操作日志。
    </el-alert>

    <div class="pc-toolbar">
      <el-button type="primary" @click="openCreate">新增渠道配置</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small" stripe>
      <el-table-column prop="channel" label="渠道" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ channelName(row.channel) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="配置名称" min-width="150" />
      <el-table-column label="归属主体" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span :style="{ color: row.legalEntityId ? '' : '#e6a23c' }">{{ entityName(row.legalEntityId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已报备类目" min-width="170">
        <template #default="{ row }">
          <template v-if="(row.categories || []).length">
            <el-tag
              v-for="c in row.categories"
              :key="c"
              size="small"
              :type="isRiskyCategory(c) ? 'danger' : 'info'"
              style="margin-right: 4px"
            >
              {{ bizCategoryLabel(c) }}
            </el-tag>
          </template>
          <span v-else style="color: #e6a23c">未设置（不校验）</span>
        </template>
      </el-table-column>
      <el-table-column prop="mchId" label="商户号" width="170" />
      <el-table-column prop="scene" label="场景" width="90" />
      <el-table-column label="环境" width="90">
        <template #default="{ row }">
          <el-tag :type="row.isSandbox ? 'warning' : 'danger'" size="small">{{ row.isSandbox ? '沙箱' : '生产' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="70">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="密钥" width="90">
        <template #default="{ row }">
          <el-tag :type="row.hasPrivateKey ? 'success' : 'danger'" size="small">
            {{ row.hasPrivateKey ? '已配置' : '未配置' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="priority" label="优先级" width="80" align="center" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggle(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑渠道配置' : '新增渠道配置'" width="620px">
      <el-alert v-if="meta" type="info" :closable="false" style="margin-bottom: 12px">
        {{ meta.mchId?.hint || '' }}<template v-if="meta.appId?.hint">；AppId {{ meta.appId.hint }}</template>
      </el-alert>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="150px">
        <el-form-item label="渠道" prop="channel">
          <el-select v-model="form.channel" :disabled="!!editing" style="width: 100%" @change="onChannelChange">
            <el-option-group label="已接入">
              <el-option v-for="o in channelOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-option-group>
            <el-option-group label="规划中（尚未接入，不能保存）">
              <el-option v-for="o in plannedOptions" :key="o.value" :label="o.label" :value="o.value" disabled>
                <span>{{ o.label }}</span>
                <span style="float: right; color: #8492a6; font-size: 12px">{{ o.reason }}</span>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="配置名称" prop="name">
          <el-input v-model="form.name" placeholder="如：微信-主商户" />
        </el-form-item>
        <el-form-item label="归属主体">
          <el-select v-model="form.legalEntityId" clearable filterable placeholder="未归属（不参与主体校验）" style="width: 100%">
            <el-option v-for="e in entityOptions" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
          <div style="color: #8492a6; font-size: 12px">一个商户号只能归属一个主体，跨主体收款属二清</div>
        </el-form-item>
        <el-form-item label="已报备类目">
          <el-select v-model="form.categories" multiple filterable placeholder="留空=不限制" style="width: 100%">
            <el-option v-for="c in BIZ_CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
          <div style="color: #8492a6; font-size: 12px">须与支付机构侧报备的类目一致；高风险类目建议单独进件</div>
        </el-form-item>
        <el-form-item :label="meta?.mchId?.label || '商户号'" prop="mchId">
          <el-input v-model="form.mchId" :placeholder="meta?.mchId?.placeholder || ''" />
        </el-form-item>
        <el-form-item v-if="meta?.appId" :label="meta.appId.label" prop="channelAppId">
          <el-input v-model="form.channelAppId" :placeholder="meta.appId.placeholder || ''" />
        </el-form-item>
        <el-form-item label="场景 scene" prop="scene">
          <el-select v-model="form.scene" style="width: 100%">
            <el-option label="全部场景" value="" />
            <el-option v-for="s in sceneOptions" :key="s" :label="SCENE_OPTIONS[s] || s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="沙箱环境">
          <el-switch v-model="form.isSandbox" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">
            {{ form.channel === 'unionpay' ? '银联测试网关 gateway.test.95516.com' : '开启后走模拟渠道，不产生真实资金' }}
          </span>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :max="99" />
          <span style="margin-left: 8px; color: #8492a6; font-size: 12px">数字越大越优先</span>
        </el-form-item>

        <!-- 按渠道渲染密钥 / 参数字段 -->
        <el-form-item
          v-for="f in meta?.secrets || []"
          :key="f.key"
          :label="f.label"
          :prop="secretProp(f.key)"
        >
          <el-select v-if="f.type === 'select'" v-model="form[f.key]" style="width: 100%">
            <el-option v-for="o in f.options" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-input v-else-if="f.type === 'textarea'" v-model="form[f.key]" type="textarea" :rows="3" :placeholder="secretPlaceholder(f)" />
          <el-input v-else-if="f.type === 'password'" v-model="form[f.key]" type="password" show-password :placeholder="secretPlaceholder(f)" />
          <el-input v-else v-model="form[f.key]" :placeholder="secretPlaceholder(f)" />
          <div v-if="f.hint" style="color: #8492a6; font-size: 12px; margin-top: 2px">{{ f.hint }}</div>
        </el-form-item>

        <el-form-item label="异步通知地址">
          <el-input v-model="form.notifyUrl" placeholder="留空使用系统默认" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
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
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { CHANNEL_META, CHANNEL_OPTIONS, PLANNED_CHANNEL_OPTIONS, SCENE_OPTIONS, channelName } from '../constants/channels';
import { BIZ_CATEGORIES, bizCategoryLabel, isRiskyCategory } from '../constants/biz-category';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(null);
const formRef = ref(null);
const form = reactive({
  channel: 'wechat',
  name: '',
  legalEntityId: null,
  categories: [],
  mchId: '',
  channelAppId: '',
  scene: 'JSAPI',
  isSandbox: true,
  priority: 0,
  certSerialNo: '',
  signType: 'RSA2',
  privateKey: '',
  platformCert: '',
  apiV3Key: '',
  notifyUrl: '',
  remark: '',
});

const channelOptions = CHANNEL_OPTIONS;

/** 法人主体下拉：主体决定这个商户号能被哪些业务系统使用 */
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
const plannedOptions = PLANNED_CHANNEL_OPTIONS;
const meta = computed(() => CHANNEL_META[form.channel]);
const sceneOptions = computed(() => meta.value?.scenes || []);

/** 密钥字段 prop：编辑态密钥留空=不修改，因此仅新增态做必填校验 */
const secretProp = (key) => (key === 'signType' ? `signType` : key);
const secretPlaceholder = (f) => (editing.value ? '留空表示不修改' : f.placeholder || '');

const rules = computed(() => {
  const m = meta.value || {};
  const r = {
    channel: [{ required: true, message: '请选择渠道' }],
    name: [{ required: true, message: '请填写配置名称', trigger: 'blur' }],
    mchId: [
      { required: true, message: `${m.mchId?.label || '商户号'}必填`, trigger: 'blur' },
      ...(m.mchId?.pattern
        ? [{ pattern: m.mchId.pattern, message: `格式不正确：${m.mchId.hint || ''}`, trigger: 'blur' }]
        : []),
    ],
  };
  if (m.appId?.pattern) {
    r.channelAppId = [
      { required: true, message: `${m.appId.label}必填`, trigger: 'blur' },
      { pattern: m.appId.pattern, message: `格式不正确：${m.appId.hint || ''}`, trigger: 'blur' },
    ];
  }
  // 密钥类必填（仅新增时强制；编辑留空沿用原值）
  for (const f of m.secrets || []) {
    if (f.required) {
      r[secretProp(f.key)] = [
        { required: !editing.value, message: `新增时必须填写「${f.label}」`, trigger: 'blur' },
      ];
    }
  }
  return r;
});

async function load() {
  loading.value = true;
  try {
    const res = await api.channels();
    list.value = res.list || res || [];
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function blankForm() {
  return {
    channel: 'wechat',
    name: '',
    legalEntityId: null,
    categories: [],
    mchId: '',
    channelAppId: '',
    scene: 'JSAPI',
    isSandbox: true,
    priority: 0,
    certSerialNo: '',
    signType: 'RSA2',
    privateKey: '',
    platformCert: '',
    apiV3Key: '',
    notifyUrl: '',
    remark: '',
  };
}

function openCreate() {
  editing.value = null;
  Object.assign(form, blankForm());
  dialogVisible.value = true;
  nextTick(() => formRef.value?.clearValidate());
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    channel: row.channel,
    name: row.name,
    legalEntityId: row.legalEntityId ?? null,
    categories: row.categories || [],
    mchId: row.mchId,
    channelAppId: row.channelAppId || '',
    scene: row.scene || '',
    isSandbox: row.isSandbox,
    priority: row.priority ?? 0,
    certSerialNo: row.certSerialNo || '',
    signType: row.signType || 'RSA2',
    privateKey: '',
    platformCert: '',
    apiV3Key: '',
    notifyUrl: row.notifyUrl || '',
    remark: row.remark || '',
  });
  dialogVisible.value = true;
  nextTick(() => formRef.value?.clearValidate());
}

/** 切换渠道时：场景重置为该渠道支持的第一个，AppId/证书类字段清空，避免跨渠道残留 */
async function onChannelChange() {
  if (!sceneOptions.value.includes(form.scene)) {
    form.scene = sceneOptions.value[0] || '';
  }
  if (!meta.value?.appId) form.channelAppId = '';
}

async function save() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    // 留空的密钥字段不下发，避免覆盖已存配置
    const payload = { ...form };
    for (const k of ['privateKey', 'platformCert', 'apiV3Key', 'certSerialNo']) {
      if (!payload[k]) delete payload[k];
    }
    if (editing.value) {
      await api.updateChannel(editing.value.id, payload);
      ElMessage.success('已保存');
    } else {
      await api.createChannel(payload);
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
    await api.updateChannel(row.id, { enabled: !row.enabled });
    ElMessage.success('已更新');
    load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(async () => {
  await loadEntities();
  load();
});
</script>
