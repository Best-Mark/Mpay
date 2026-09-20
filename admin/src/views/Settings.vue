<template>
  <div class="page">
    <el-alert
      v-if="!smtpReady"
      type="warning"
      show-icon
      :closable="false"
      title="邮件服务尚未配置完成"
      description="未配置 SMTP 时，商户注册验证码与系统告警邮件都不会发出。配置保存在数据库中，改完立即生效，无需重启服务。"
      class="mb"
    />

    <el-tabs v-model="active" tab-position="left" class="tabs">
      <!-- ===== 邮件 ===== -->
      <el-tab-pane label="邮件服务" name="mail">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>SMTP 发件配置</span>
              <el-tag :type="smtpReady ? 'success' : 'info'" size="small">
                {{ smtpReady ? '已配置' : '未配置' }}
              </el-tag>
            </div>
          </template>

          <el-form label-width="140px" class="form">
            <el-form-item label="启用邮件服务">
              <el-switch v-model="form['mail.enabled']" />
              <span class="hint">关闭后不发送任何邮件</span>
            </el-form-item>
            <el-form-item label="SMTP 服务器">
              <el-input v-model="form['mail.host']" placeholder="smtp.qq.com" class="w360" />
            </el-form-item>
            <el-form-item label="端口">
              <el-input v-model="form['mail.port']" class="w180" />
              <span class="hint">465=SSL，587=STARTTLS</span>
            </el-form-item>
            <el-form-item label="使用 SSL">
              <el-switch v-model="form['mail.secure']" />
              <span class="hint">端口 465 选开；587 选关</span>
            </el-form-item>
            <el-form-item label="SMTP 账号">
              <el-input v-model="form['mail.user']" placeholder="通常为完整邮箱" class="w360" />
            </el-form-item>
            <el-form-item label="密码/授权码">
              <el-input
                v-model="form['mail.pass']"
                type="password"
                show-password
                :placeholder="mailPassSet ? '已设置，留空表示不修改' : '邮箱服务商生成的授权码'"
                class="w360"
              />
              <span v-if="mailPassSet" class="hint">已保存，留空则不修改</span>
            </el-form-item>
            <el-form-item label="发件人地址">
              <el-input v-model="form['mail.from']" placeholder="留空则使用 SMTP 账号" class="w360" />
            </el-form-item>
            <el-form-item label="发件人名称">
              <el-input v-model="form['mail.fromName']" class="w360" />
            </el-form-item>
          </el-form>

          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save('mail')">保存邮件配置</el-button>
            <el-button :loading="testing" @click="testMail">发送测试邮件</el-button>
          </div>
          <div class="tip">
            测试发信用的是「已保存」的配置：改完请先保存再测试。常见坑是端口与 SSL 不对应（465 开 SSL、587 关 SSL），
            以及把邮箱登录密码当成授权码。
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ===== 注册 ===== -->
      <el-tab-pane label="商户注册" name="register">
        <el-card shadow="never">
          <template #header>自助入驻开关</template>
          <el-form label-width="150px" class="form">
            <el-form-item label="开放自助注册">
              <el-switch v-model="form['register.enabled']" />
              <span class="hint">关闭时注册页直接拒绝提交</span>
            </el-form-item>
            <el-form-item label="需邮箱验证码">
              <el-switch v-model="form['register.verifyEmail']" />
              <span class="hint">关闭则无需验证邮箱真伪，不建议</span>
            </el-form-item>
            <el-form-item label="自动审核通过">
              <el-switch v-model="form['register.autoApprove']" />
              <span class="hint">开启后免人工审核，直接开通业务系统</span>
            </el-form-item>
            <el-form-item label="审核结果邮件通知">
              <el-switch v-model="form['register.auditNotify']" />
            </el-form-item>
          </el-form>
          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save('register')">保存注册配置</el-button>
            <el-button @click="copyRegisterUrl">复制入驻页地址</el-button>
          </div>
          <div class="tip">
            支付系统是资金入口，注册默认关闭；确认要对外开放时再手动开启，并建议保持人工审核。
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ===== 告警 ===== -->
      <el-tab-pane label="告警" name="alert">
        <el-card shadow="never">
          <template #header>告警收件与阈值</template>
          <el-form label-width="150px" class="form">
            <el-form-item label="告警收件人">
              <el-input v-model="form['alert.emails']" placeholder="ops@xxx.com,finance@xxx.com" class="w420" />
              <span class="hint">多个用英文逗号分隔</span>
            </el-form-item>
            <el-form-item label="通知死信告警">
              <el-switch v-model="form['alert.notifyDeadLetter']" />
              <span class="hint">通知重试耗尽时发邮件</span>
            </el-form-item>
            <el-form-item label="对账差异告警">
              <el-switch v-model="form['alert.reconcileDiff']" />
            </el-form-item>
            <el-form-item label="差异笔数阈值">
              <el-input v-model="form['alert.diffThreshold']" class="w180" />
            </el-form-item>
            <el-form-item label="静默期(分钟)">
              <el-input v-model="form['alert.silentMinutes']" class="w180" />
              <span class="hint">同类告警在该时间内只发一次</span>
            </el-form-item>
            <el-form-item label="个人码挂账告警">
              <el-switch v-model="form['alert.personalQrUnmatched']" />
              <span class="hint">监控器上报但匹配不到订单时告警</span>
            </el-form-item>
          </el-form>
          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save('alert')">保存告警配置</el-button>
            <el-button :loading="testingAlert" @click="testAlert">发送测试告警</el-button>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ===== 站点 ===== -->
      <el-tab-pane label="站点信息" name="site">
        <el-card shadow="never">
          <template #header>品牌与对外信息</template>
          <el-form label-width="150px" class="form">
            <el-form-item label="站点名称">
              <el-input v-model="form['site.name']" class="w360" />
            </el-form-item>
            <el-form-item label="站点 Logo">
              <div class="logo-row">
                <img v-if="form['site.logo']" :src="form['site.logo']" class="logo" alt="logo" />
                <el-upload
                  :http-request="uploadLogo"
                  :show-file-list="false"
                  accept="image/*"
                >
                  <el-button size="small">上传图片</el-button>
                </el-upload>
                <span class="hint">自动压缩并转 WebP（最长边 480px）</span>
              </div>
            </el-form-item>
            <el-form-item label="对外访问地址">
              <el-input v-model="form['site.baseUrl']" placeholder="https://pay.example.com" class="w420" />
            </el-form-item>
            <el-form-item label="联系邮箱">
              <el-input v-model="form['site.contactEmail']" class="w360" />
            </el-form-item>
            <el-form-item label="备案号">
              <el-input v-model="form['site.icp']" class="w360" />
            </el-form-item>
          </el-form>
          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save('site')">保存站点信息</el-button>
          </div>
        </el-card>
      </el-tab-pane>
      <!-- ===== 个人收款码 ===== -->
      <el-tab-pane label="个人收款码" name="personalQr">
        <el-card shadow="never">
          <template #header>到账监控与自动确认</template>
          <el-form label-width="150px" class="form">
            <el-form-item label="到账自动确认">
              <el-switch v-model="form['personalQr.autoConfirm']" />
              <span class="hint">关闭后每笔到账都需后台人工绑定确认</span>
            </el-form-item>
            <el-form-item label="匹配时间窗(分钟)">
              <el-input v-model="form['personalQr.matchWindowMinutes']" class="w180" />
              <span class="hint">在该窗口内的待付订单才参与匹配</span>
            </el-form-item>
            <el-form-item label="唯一金额识别码">
              <el-switch v-model="form['personalQr.uniqueAmount']" />
              <span class="hint">应付金额加 0.01~0.90 元识别码，到账金额即订单唯一键（付款人多付几分钱）</span>
            </el-form-item>
          </el-form>
          <div class="actions">
            <el-button type="primary" :loading="saving" @click="save('personalQr')">保存个人码配置</el-button>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="mailDialog" title="发送测试邮件" width="420px">
      <el-form label-width="80px">
        <el-form-item label="收件邮箱">
          <el-input v-model="testTo" placeholder="用于接收测试邮件的邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mailDialog = false">取消</el-button>
        <el-button type="primary" :loading="testing" @click="submitTestMail">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const active = ref('mail');
const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const testingAlert = ref(false);
const smtpReady = ref(false);
const form = ref({});
const mailPassSet = ref(false);
const mailDialog = ref(false);
const testTo = ref('');

const GROUPS = ['mail', 'register', 'alert', 'personalQr', 'site'];

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const data = await api.settings();
    smtpReady.value = !!data.smtpReady;
    const next = {};
    for (const g of GROUPS) {
      for (const item of data.groups[g] || []) {
        next[item.key] = toBool(item.key, item.value);
        if (item.key === 'mail.pass') mailPassSet.value = item.hasValue;
      }
    }
    form.value = next;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

/** 后端统一存字符串，前端开关需要布尔 */
const BOOL_KEYS = [
  'mail.enabled', 'mail.secure',
  'register.enabled', 'register.autoApprove', 'register.verifyEmail', 'register.auditNotify',
  'alert.notifyDeadLetter', 'alert.reconcileDiff', 'alert.personalQrUnmatched',
  'personalQr.autoConfirm', 'personalQr.uniqueAmount',
];
function toBool(key, value) {
  return BOOL_KEYS.includes(key) ? value === 'true' : value;
}

async function save(group) {
  saving.value = true;
  try {
    const values = {};
    for (const [k, v] of Object.entries(form.value)) {
      if (!k.startsWith(group + '.')) continue;
      values[k] = typeof v === 'boolean' ? String(v) : v ?? '';
    }
    await api.saveSettings(group, values);
    ElMessage.success('已保存，立即生效');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

function testMail() {
  testTo.value = '';
  mailDialog.value = true;
}

async function submitTestMail() {
  if (!testTo.value) return ElMessage.warning('请填写收件邮箱');
  testing.value = true;
  try {
    const r = await api.testMail({ to: testTo.value });
    if (r.ok) {
      ElMessage.success(r.message);
      mailDialog.value = false;
    } else {
      ElMessage.error(r.message);
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    testing.value = false;
  }
}

async function testAlert() {
  testingAlert.value = true;
  try {
    await api.testAlert();
    ElMessage.success('测试告警已发送');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    testingAlert.value = false;
  }
}

async function uploadLogo({ file }) {
  try {
    const r = await api.uploadImage(file, 'logo');
    form.value['site.logo'] = r.url;
    ElMessage.success(`已上传（${(r.size / 1024).toFixed(0)}KB，${r.width}×${r.height}）`);
  } catch (e) {
    ElMessage.error(e.message);
  }
}

function copyRegisterUrl() {
  const url = `${location.origin}${location.pathname}#/register`;
  navigator.clipboard?.writeText(url);
  ElMessage.success(`入驻页地址已复制：${url}`);
}
</script>

<style scoped>
.page { padding: 4px; }
.mb { margin-bottom: 12px; }
.tabs { min-height: 420px; }
.form { max-width: 760px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.hint { margin-left: 10px; color: #909399; font-size: 12px; }
.w180 { width: 180px; }
.w360 { width: 360px; }
.w420 { width: 420px; }
.actions { margin-top: 18px; display: flex; gap: 10px; }
.tip { margin-top: 10px; color: #909399; font-size: 12px; line-height: 1.7; max-width: 760px; }
.logo-row { display: flex; align-items: center; gap: 12px; }
.logo { height: 40px; border: 1px solid #eee; border-radius: 4px; padding: 2px; background: #fff; }
</style>
