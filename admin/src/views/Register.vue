<template>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <img v-if="config.logo" :src="config.logo" class="logo" alt="logo" />
        <h2>{{ config.siteName || '统一支付中心' }} · 商户入驻</h2>
      </div>

      <el-alert
        v-if="!config.enabled"
        type="info"
        :closable="false"
        show-icon
        title="暂未开放自助注册"
        :description="config.contactEmail ? `如需接入请联系 ${config.contactEmail}` : '如需接入请联系平台运营人员。'"
      />

      <template v-else>
        <el-alert
          v-if="config.needVerifyCode && !config.mailReady"
          type="warning"
          :closable="false"
          show-icon
          title="平台邮件服务未配置"
          description="验证码暂时无法发送，请稍后再试或联系平台管理员。"
        />

        <el-form ref="formRef" :model="form" :rules="rules" label-width="120px" class="form">
          <el-form-item label="公司/主体" prop="companyName">
            <el-input v-model="form.companyName" placeholder="与营业执照一致的名称" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="form.email" placeholder="用于登录与接收密钥" />
          </el-form-item>
          <el-form-item v-if="config.needVerifyCode" label="验证码" prop="code">
            <div class="code-row">
              <el-input v-model="form.code" maxlength="6" placeholder="6 位验证码" />
              <el-button :disabled="countdown > 0 || sending" @click="sendCode">
                {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
          <el-form-item label="登录密码" prop="password">
            <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位" />
          </el-form-item>
          <el-form-item label="确认密码" prop="password2">
            <el-input v-model="form.password2" type="password" show-password />
          </el-form-item>
          <el-form-item label="联系人" prop="contactName">
            <el-input v-model="form.contactName" />
          </el-form-item>
          <el-form-item label="联系电话" prop="contactPhone">
            <el-input v-model="form.contactPhone" />
          </el-form-item>
          <el-form-item label="网站">
            <el-input v-model="form.website" placeholder="https://" />
          </el-form-item>
          <el-form-item label="支付通知地址" prop="payNotifyUrl">
            <el-input v-model="form.payNotifyUrl" placeholder="接收支付结果的回调地址，审核通过时用到" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="业务场景、预计量级等" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submit">提交入驻申请</el-button>
            <el-button link @click="goPortal">已有账号？去登录</el-button>
          </el-form-item>
        </el-form>
      </template>

      <!-- 提交结果 -->
      <el-result
        v-if="result"
        :icon="result.needReview ? 'info' : 'success'"
        :title="result.needReview ? '申请已提交，等待审核' : '入驻成功'"
        :sub-title="result.needReview ? '审核通过后密钥将发送到您的邮箱' : '请妥善保存下方密钥，系统不再明文展示'"
      >
        <template v-if="!result.needReview" #extra>
          <div class="secret">
            <div><span>AppId</span><code>{{ result.appId }}</code></div>
            <div><span>AppSecret</span><code class="red">{{ result.appSecret }}</code></div>
          </div>
          <el-button type="primary" @click="goPortal">去商户后台查看</el-button>
        </template>
      </el-result>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { portalApi } from '../api';

const config = ref({ enabled: false, needVerifyCode: true, mailReady: false, siteName: '', logo: '' });
const formRef = ref();
const submitting = ref(false);
const sending = ref(false);
const countdown = ref(0);
const result = ref(null);
let timer = null;

const form = reactive({
  companyName: '',
  email: '',
  code: '',
  password: '',
  password2: '',
  contactName: '',
  contactPhone: '',
  website: '',
  payNotifyUrl: '',
  remark: '',
});

const rules = computed(() => ({
  companyName: [{ required: true, message: '请填写公司/主体名称', trigger: 'blur' }],
  email: [
    { required: true, message: '请填写邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  // 平台关闭邮箱验证时不必填验证码
  code: config.value.needVerifyCode ? [{ required: true, message: '请填写验证码', trigger: 'blur' }] : [],
  password: [{ min: 8, message: '密码至少 8 位', trigger: 'blur' }],
  password2: [
    {
      validator: (_r, value, cb) => (value === form.password ? cb() : cb(new Error('两次输入的密码不一致'))),
      trigger: 'blur',
    },
  ],
}));

onMounted(async () => {
  try {
    config.value = await portalApi.config();
  } catch (e) {
    ElMessage.error(e.message);
  }
});

onUnmounted(() => timer && clearInterval(timer));

async function sendCode() {
  if (!form.email) return ElMessage.warning('请先填写邮箱');
  sending.value = true;
  try {
    const r = await portalApi.sendCode(form.email);
    if (r.sent) {
      ElMessage.success(r.message);
      countdown.value = 60;
      timer = setInterval(() => {
        countdown.value -= 1;
        if (countdown.value <= 0) clearInterval(timer);
      }, 1000);
    } else {
      ElMessage.warning(r.message);
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    sending.value = false;
  }
}

async function submit() {
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  submitting.value = true;
  try {
    const r = await portalApi.register({
      companyName: form.companyName,
      email: form.email,
      code: form.code,
      password: form.password,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      website: form.website,
      payNotifyUrl: form.payNotifyUrl,
      remark: form.remark,
    });
    result.value = r;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    submitting.value = false;
  }
}

function goPortal() {
  location.hash = '#/portal';
}
</script>

<style scoped>
.wrap { min-height: 100vh; background: #f0f2f5; padding: 40px 16px; }
.card { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 28px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.head h2 { font-size: 18px; font-weight: 600; }
.logo { height: 32px; }
.form { margin-top: 20px; }
.code-row { display: flex; gap: 10px; }
.secret { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.secret span { display: inline-block; width: 84px; color: #606266; }
.secret code { background: #f5f7fa; padding: 4px 8px; border-radius: 4px; word-break: break-all; }
.secret .red { color: #c0392b; }
</style>
