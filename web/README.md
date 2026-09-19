# 统一支付中心 · 对外官网（C 端）

面向**支付渠道审核**（微信支付商户号 / 支付宝开放平台申请）与品牌展示的静态官网。
审核方实际会打开网站核对经营内容、公司主体、联系方式、备案号与法务条款，本站点已按该要求组织内容。

## 特点

- 纯静态 SPA（Vue 3 + Vite + hash 路由），不依赖后端接口，部署零后端改造
- `base: './'` 相对路径产物：**根域名**（`https://pay.example.com/`）或**子目录**（`https://example.com/www/`）都能直接跑
- 站点文案、公司信息、备案号、联系方式全部集中在 `src/site.config.js`，上线只改这一个文件
- 内置页面：首页、核心功能、应用场景、接入文档、关于我们（含公司信息与联系方式）、服务协议、隐私政策
- 页脚公示备案号与法务入口，符合渠道审核对「网站内容完整」的要求

## 本地开发

```bash
cd web
npm install
npm run dev        # http://localhost:5273
```

## 构建

```bash
npm run build      # 产物在 web/dist
```

## 部署

### 方式一：独立子域名（推荐，对现有后台零影响）

宝塔「网站 → 添加站点」，域名填 `www.7zan.com`（或 `pay.7zan.com`），根目录 `/www/wwwroot/xxx`，
把 `web/dist` 内的文件放到站点根目录即可，Nginx 只需静态能力：

```nginx
server {
    listen 80;
    server_name www.7zan.com;
    root /www/wwwroot/pay-web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|webp|ico)$ {
        expires 7d;
        access_log off;
    }
}
```

### 方式二：复用现有域名（mpay.7zan.com 根路径）

当前根路径被管理后台占用，需把后台迁到子路径：

1. `admin/vite.config.js` 增加 `base: '/admin/'`
2. Nginx 增加 `location ^~ /admin/ { alias /www/wwwroot/mpay.7zan.com/admin/dist/; try_files $uri $uri/ /admin/index.html; }`
3. 官网产物放到独立目录，Nginx 的 `location /` 指向 `web/dist`

> hash 路由下 URL 形如 `https://mpay.7zan.com/admin/#/login`，无需额外重写规则。

## 上线前必改

打开 `src/site.config.js`，把占位内容替换为真实信息（必须与营业执照、备案信息一致）：

| 字段 | 说明 |
| --- | --- |
| `siteUrl` / `consoleUrl` / `registerUrl` / `docsUrl` | 部署后的真实地址 |
| `company.*` | 公司全称、统一社会信用代码、成立时间、地址、经营范围 |
| `icp` | ICP 备案号（页脚公示，审核会核对） |
| `contact.*` | 客服邮箱、电话、服务时间（审核会抽查可用性） |

其余文案（能力卡片、场景、接入流程、数据亮点）可直接沿用，也可按实际业务增删。

## 审核注意

- 页面不要留「建设中 / 敬请期待」字样，所有导航链接必须可达
- 备案号、公司主体、联系方式保持与提交给渠道的资料一致
- 服务协议与隐私政策需可正常访问（已内置）
