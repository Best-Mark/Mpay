<template>
  <div class="install-page">
    <div class="install-card">
      <div class="brand">
        <span class="logo">💳</span>
        <h2>统一支付中心</h2>
      </div>
      <p class="sub">首次安装向导</p>

      <el-steps :active="step" finish-status="success" align-center class="steps">
        <el-step title="环境检测" />
        <el-step title="数据库" />
        <el-step title="站点与管理员" />
        <el-step title="完成" />
      </el-steps>

      <!-- ===== 1. 环境检测 ===== -->
      <div v-if="step === 0" class="pane">
        <el-table :data="checks" size="small" class="check-table">
          <el-table-column prop="name" label="检测项" width="120" />
          <el-table-column label="结果" width="70">
            <template #default="{ row }">
              <el-tag v-if="row.ok === true" type="success" size="small">通过</el-tag>
              <el-tag v-else-if="row.ok === false" type="danger" size="small">失败</el-tag>
              <el-tag v-else type="info" size="small">待配置</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="detail" label="说明" />
        </el-table>
        <el-alert
          v-if="!envOk"
          type="error"
          :closable="false"
          title="环境检测未通过：请先解决上面的失败项后重新检测"
          class="mt"
        />
        <div v-if="status?.tokenRequired" class="token-row">
          <span>安装令牌</span>
          <el-input v-model="token" placeholder="部署时设置的 INSTALL_TOKEN（也可用 /install?token=xxx 带入）" />
        </div>
        <div class="actions">
          <el-button :loading="loading" @click="loadStatus">重新检测</el-button>
          <el-button type="primary" :disabled="!envOk" @click="step = 1">下一步</el-button>
        </div>
      </div>

      <!-- ===== 2. 数据库 ===== -->
      <div v-else-if="step === 1" class="pane">
        <el-form label-width="96px" size="default">
          <el-form-item label="数据库地址">
            <el-input v-model="form.db.host" placeholder="127.0.0.1" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input v-model.number="form.db.port" placeholder="3306" style="width: 120px" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="form.db.user" placeholder="root" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="form.db.password" type="password" show-password placeholder="可为空" />
          </el-form-item>
          <el-form-item label="数据库名">
            <el-input v-model="form.db.database" placeholder="pay_center" @blur="normalizeDbNameInput" />
            <div class="hint">
              可自定义（字母/数字/下划线，长度 1-64）；不存在时会自动创建，不会动其它库。<b>含大写字母将自动转为小写</b>——Linux 下 MySQL 库名区分大小写，混用会出现「库已存在却连不上」
            </div>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="dbTest"
          :type="dbTest.ok ? 'success' : 'error'"
          :closable="false"
          class="mt"
          :title="
            dbTest.ok
              ? `连接成功（${dbTest.serverVersion || 'MySQL'}）· 库${dbTest.databaseExists ? '已存在' : '不存在，将自动创建'}${
                  dbTest.canCreateDatabase ? '' : ' · ⚠️ 该账号无建库权限，需管理员先建库'
                }${
                  dbTest.nameAdjusted
                    ? ` · 数据库名已自动转为小写「${dbTest.normalizedDatabase}」（MySQL 区分大小写）`
                    : ''
                }`
              : `连接失败：${dbTest.message}`
          "
        />
        <div class="actions">
          <el-button @click="step = 0">上一步</el-button>
          <el-button :loading="testing" @click="testDb">测试连接</el-button>
          <el-button type="primary" :disabled="!form.db.host || !form.db.database" @click="step = 2">下一步</el-button>
        </div>
      </div>

      <!-- ===== 3. 站点与管理员 ===== -->
      <div v-else-if="step === 2" class="pane">
        <el-form label-width="110px" size="default">
          <el-form-item label="对外访问地址">
            <div class="row">
              <el-input v-model="form.site.payBaseUrl" placeholder="https://pay.example.com" />
              <el-button :disabled="!form.site.payBaseUrl" @click="checkUrl">检测</el-button>
            </div>
            <div class="hint">用于拼接渠道异步回调地址，需为公网可访问的 HTTPS 地址</div>
            <div v-if="urlCheck" class="hint" :class="urlCheck.ok ? 'ok' : 'bad'">{{ urlCheck.message }}</div>
          </el-form-item>
          <el-form-item label="服务端口">
            <div class="row">
              <el-input v-model.number="form.site.port" style="width: 120px" />
              <el-button @click="checkPort">检测占用</el-button>
            </div>
            <div class="hint">后端监听端口（改动后重启生效，Nginx / 防火墙需同步放通）</div>
            <div v-if="portCheck" class="hint" :class="portCheck.inUse ? 'bad' : 'ok'">{{ portCheck.message }}</div>
          </el-form-item>
          <el-form-item label="渠道模式">
            <el-radio-group v-model="form.site.channelMode">
              <el-radio value="sandbox">沙箱（Mock 代理，联调用）</el-radio>
              <el-radio value="prod">生产（真实渠道）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="加密主密钥">
            <el-input v-model="form.site.masterKey" placeholder="留空自动生成 32 字节随机密钥" />
            <div class="hint">商户私钥 / AppSecret 的加密密钥，安装后不可随意更改（会导无法解密历史数据）</div>
          </el-form-item>
          <el-form-item label="Redis">
            <el-switch v-model="form.redis.enabled" active-text="启用" inactive-text="不启用" />
            <div class="hint">多实例部署必须启用；不启用时降级为进程内实现（仅适合单机）</div>
          </el-form-item>
          <template v-if="form.redis.enabled">
            <el-form-item label="Redis 地址">
              <el-input v-model="form.redis.host" placeholder="127.0.0.1" />
            </el-form-item>
            <el-form-item label="Redis 端口">
              <el-input v-model.number="form.redis.port" placeholder="6379" style="width: 120px" />
            </el-form-item>
            <el-form-item label="Redis 密码">
              <el-input v-model="form.redis.password" type="password" show-password placeholder="可为空" />
            </el-form-item>
          </template>
          <el-form-item label="管理员账号">
            <el-input v-model="form.admin.username" placeholder="admin" />
          </el-form-item>
          <el-form-item label="管理员密码">
            <el-input v-model="form.admin.password" type="password" show-password placeholder="至少 8 位" />
          </el-form-item>
          <el-form-item label="确认密码">
            <el-input v-model="confirmPassword" type="password" show-password placeholder="再次输入" />
          </el-form-item>
        </el-form>
        <div class="actions">
          <el-button @click="step = 1">上一步</el-button>
          <el-button type="primary" :loading="installing" @click="doInstall">开始安装</el-button>
        </div>
      </div>

      <!-- ===== 4. 完成 ===== -->
      <div v-else class="pane">
        <el-result v-if="!result" icon="info" title="准备安装" sub-title="点击开始后自动建库建表并创建管理员" />
        <template v-else>
          <el-result icon="success" title="安装完成">
            <template #sub-title>
              <div>数据库：{{ result.database }}{{ result.databaseCreated ? '（已自动创建）' : '（已存在）' }}</div>
              <div v-if="result.databaseNormalized" class="warn">
                数据库名已自动规范化（大小写）：{{ result.databaseRequested }} → {{ result.database }}
              </div>
              <div>应用迁移：{{ result.appliedMigrations.length }} 个</div>
              <div>管理员：{{ form.admin.username }} / {{ form.admin.password }}</div>
              <div class="warn">请妥善保存管理员密码，安装完成后建议立即登录修改</div>
              <div class="next">
                下一步：登录后到「系统设置 → 邮件服务」配置 SMTP，用于商户注册验证码与系统告警邮件（注册默认关闭，需手动开启）。
              </div>
            </template>
          </el-result>
          <el-alert
            v-if="restartMsg"
            :type="restartMsg.type"
            :closable="false"
            class="mt"
            :title="restartMsg.text"
          />
        </template>
        <el-alert
          v-if="result && runtime && !runtime.canAutoRestart"
          type="warning"
          :closable="false"
          class="mt"
          :title="runtime.restartHint"
        />
        <div class="actions">
          <el-button v-if="!result" type="primary" :loading="installing" @click="doInstall">开始安装</el-button>
          <template v-else>
            <el-button v-if="runtime?.canAutoRestart" :loading="waitingRestart" @click="doRestart">重启服务</el-button>
            <el-button type="primary" :disabled="!serviceUp" @click="goLogin">进入登录</el-button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const router = useRouter();
const step = ref(0);
const loading = ref(false);
const testing = ref(false);
const installing = ref(false);
const waitingRestart = ref(false);
const serviceUp = ref(false);
const confirmPassword = ref('');
const status = ref(null);
const dbTest = ref(null);
const result = ref(null);
const restartMsg = ref(null);
const runtime = ref(null);
const portCheck = ref(null);
const urlCheck = ref(null);
// 安装令牌：部署时若设置了 INSTALL_TOKEN，可通过 /install?token=xxx 带入
const token = ref(new URLSearchParams(location.search).get('token') || '');

const form = reactive({
  db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'pay_center' },
  redis: { enabled: false, host: '127.0.0.1', port: 6379, password: '' },
  site: { payBaseUrl: '', masterKey: '', channelMode: 'sandbox', port: 3000 },
  admin: { username: 'admin', password: '' },
});

const checks = computed(() => status.value?.checks || []);
const envOk = computed(() => checks.value.every((c) => c.ok !== false));

async function loadStatus() {
  loading.value = true;
  try {
    const s = await api.installStatus();
    status.value = s;
    runtime.value = s.runtime;
    if (s.port) form.site.port = s.port;
    // 用服务端已有配置回填（密码不回传，需手工填）
    if (s.db?.host) {
      form.db.host = s.db.host;
      form.db.port = s.db.port || 3306;
      form.db.user = s.db.user || '';
      if (s.db.database) form.db.database = s.db.database;
    }
    if (s.site?.payBaseUrl) form.site.payBaseUrl = s.site.payBaseUrl;
    if (s.site?.channelMode) form.site.channelMode = s.site.channelMode;
    if (s.site?.redisEnabled) {
      form.redis.enabled = true;
      form.redis.host = s.site.redisHost || '127.0.0.1';
      form.redis.port = s.site.redisPort || 6379;
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

/** 数据库名规范化：MySQL 在 Linux 下区分库名大小写，统一按小写提交 */
function normalizeDbNameInput() {
  const v = String(form.db.database || '').trim().toLowerCase();
  if (v && v !== form.db.database) {
    form.db.database = v;
    ElMessage.info(`数据库名已自动转为小写：${v}`);
  }
}

async function testDb() {
  normalizeDbNameInput();
  testing.value = true;
  try {
    dbTest.value = await api.installTestDb({ ...form.db }, token.value);
    // 服务端若按现有库校正了库名，回填到表单，避免安装时使用不一致的名字
    if (dbTest.value?.ok && dbTest.value.nameAdjusted && dbTest.value.normalizedDatabase) {
      form.db.database = dbTest.value.normalizedDatabase;
    }
  } catch (e) {
    dbTest.value = { ok: false, message: e.message };
  } finally {
    testing.value = false;
  }
}

async function checkPort() {
  try {
    portCheck.value = await api.installCheckPort(form.site.port, token.value);
  } catch (e) {
    portCheck.value = { inUse: true, message: e.message };
  }
}

async function checkUrl() {
  try {
    urlCheck.value = await api.installCheckUrl(form.site.payBaseUrl, token.value);
  } catch (e) {
    urlCheck.value = { ok: false, message: e.message };
  }
}

async function doInstall() {
  if (form.admin.password !== confirmPassword.value) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  // 兜底：未点「测试连接」直接安装时也要规范化库名
  normalizeDbNameInput();
  installing.value = true;
  step.value = 3;
  try {
    result.value = await api.installApply(
      { db: form.db, redis: form.redis, site: form.site, admin: form.admin },
      token.value,
    );
    // 安装完成：自动触发一次重启，让 Prisma 加载新的连接串
    await doRestart();
  } catch (e) {
    ElMessage.error(e.message);
    step.value = 2;
  } finally {
    installing.value = false;
  }
}

async function doRestart() {
  if (!result.value?.restartToken) return;
  waitingRestart.value = true;
  const auto = runtime.value?.canAutoRestart;
  restartMsg.value = {
    type: 'info',
    text: auto ? '正在重启服务，守护进程会自动拉起…' : '进程正在退出，请按下方命令手动启动…',
  };
  try {
    await api.installRestart(result.value.restartToken, token.value);
  } catch {
    /* 进程退出可能导致请求中断，属预期 */
  }
  if (!auto) {
    waitingRestart.value = false;
    restartMsg.value = { type: 'warning', text: runtime.value?.restartHint || '请手动启动服务' };
    return;
  }
  // 轮询直到服务重新可用
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await api.installStatus();
      serviceUp.value = true;
      waitingRestart.value = false;
      restartMsg.value = { type: 'success', text: '服务已重新启动，可进入登录' };
      return;
    } catch {
      /* 继续等待 */
    }
  }
  waitingRestart.value = false;
  restartMsg.value = { type: 'warning', text: '未检测到服务自动拉起，请手动重启后端后刷新本页' };
}

function goLogin() {
  router.push('/login');
}

onMounted(loadStatus);
</script>

<style scoped>
.install-page {
  min-height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  background: linear-gradient(135deg, #2f6fed 0%, #1a3fa0 100%);
}

.install-card {
  width: 640px;
  background: #fff;
  border-radius: 12px;
  padding: 28px 28px 20px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand h2 {
  margin: 0;
  font-size: 19px;
}

.logo {
  font-size: 26px;
}

.sub {
  color: #8492a6;
  font-size: 13px;
  margin: 4px 0 18px;
}

.steps {
  margin-bottom: 18px;
}

.pane {
  min-height: 260px;
}

.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 2px;
}

.mt {
  margin-top: 12px;
}

.warn {
  margin-top: 6px;
  color: #e6a23c;
}

.next {
  margin-top: 6px;
  color: #606266;
}

.row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.ok {
  color: #67c23a;
}

.bad {
  color: #f56c6c;
}

.token-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 13px;
  color: #606266;
}

.token-row span {
  flex: 0 0 64px;
}

.actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.check-table {
  width: 100%;
}
</style>
