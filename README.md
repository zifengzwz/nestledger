# 小家有账 · NestLedger

基于 **Vue 3 + TypeScript / OpenResty Lua / MongoDB / Redis** 的个人与家庭记账平台。按[需求文档](需求.md)实现：MongoDB保存用户、账本和收支数据，Redis缓存登录会话。**仅提供本机运行方式，不包含容器部署。** 项目定位、功能概览与技术架构见[项目简介](docs/INTRO.md)。

## 功能

- 手机号＋密码注册、登录、退出，修改密码和更换手机号。
- 多个个人、家庭账本，创建、切换、更名、删除；左侧列表最多同时显示5本，超过5本可滚动查看，点击切换并高亮当前账本，不限制账本总数；点击“排序”可拖拽或上移／下移，顺序自动保存到当前账号，刷新和其他设备登录后保留，不影响其他成员的顺序。
- 个人账本默认仅本人可见，所有者也可只读分享给指定用户；家庭账本所有者通过手机号邀请，受邀人接受或拒绝。只能邀请已注册的手机号；未注册号码会被拒绝，需对方先注册后再邀请。
- 家庭成员查看、所有者移除成员、成员退出；所有者不能直接退出。
- 账本所有者可按手机号把账本**只读分享给指定已注册用户**；对方可在「我的邀请」中接受或拒绝；接受后账本列表显示「只读」标记和原账本用户的昵称、手机号，可查看记录和收支分析，但不能新增、修改、导入或导出；拥有者可随时取消分享，删除账本会同时清除分享；被拒绝后可重新发送邀请。
- 收入／支出记录，时间、分类、金额、备注、支付方式；搜索、筛选、分页、编辑、删除。
- 家庭账本显示每笔记录的记录人（当前登录成员显示为「我」）；账本概览、收支明细、收支分析都支持按成员筛选，分析页提供成员收入／支出／结余／笔数统计，历史记录在成员退出后仍保留归属。收支分析还可切换「全部账本」范围：只汇总我拥有或加入的账本中由我记录的收支（不含只读分享账本），并列出各账本分项。
- 记账时可在分类／支付方式旁点击“添加”，保存自定义收入分类、支出分类、支付方式到账号，下次下拉可选择；新增时可从35个图标中选择，名称和图标一起保存并跨设备保留；三类各最多50个，名称1–40字，重复拒绝；仍支持不保存为常用选项的临时自由输入。
- 账本成员可查看与创建记录；仅记录创建人或账本所有者可编辑、删除。
- 当前账本支持CSV／JSON导出、日期范围、CSV模板；导入先预览与服务器整批校验，再确认追加，单次1–5000笔／10MiB，同一次请求重试防重复，不覆盖旧记录。详见[导入导出说明](docs/IMPORT_EXPORT.md)。
- 自然周／月／年分析，收入、支出、结余、记录数、趋势图和支出分类；**Asia/Shanghai** 时区、周一为一周开始。
- 分类和支付方式带本地SVG图标，记账输入框／下拉、收支记录及分类分析统一显示；默认项对应图标，自定义项显示用户所选图标，历史未选图标的项仍有通用标签／收入／钱包回退。
- 金额存储、传输和累计使用**整数分**，避免浮点金额误差。
- 中文响应式界面，桌面侧栏／手机抽屉导航，加载、错误重试、空态、确认弹窗及键盘焦点管理。
- 内置8套色调（陶土暖棕、森林青绿、雾蓝浅灰、烟紫暮色、珊瑚橙、芒果黄、薄荷青、莓果红），可在「账户与安全 → 界面色调」切换，即时生效并同步到账号；本地缓存预加载避免刷新闪烁。详见[界面色调](docs/THEMES.md)。

## 本机启动

完整部署流程（依赖安装、数据库初始化、HTTPS 证书、systemd 常驻、备份恢复与排障）见[部署指南](docs/DEPLOYMENT.md)。

### 依赖

- 构建机：Node.js **22.12+ 或24 LTS**、npm（仅用于打包前端，部署机不需要）。
- 部署机：OpenResty（不是普通nginx），包含 `resty.redis`、`resty.lock`、Lua CJSON，另安装 `lua-resty-openssl` 与 `lua-resty-http`。
- 部署机：MongoDB **5+，推荐8.0**；Redis **7+**。
- 部署机：Python **3.10+**（启动脚本生成配置及集成测试，不参与服务端业务运行）。

各发行版的完整安装命令（OpenResty、MongoDB、Redis、Node.js）见[部署指南的依赖安装](docs/DEPLOYMENT.md#2-安装依赖)。

安装OpenResty后，若缺少密码哈希依赖：

```bash
luarocks install lua-resty-openssl
```

可以先检查模块：

```bash
resty -e 'require("resty.redis"); require("resty.lock"); require("resty.openssl.kdf"); print("Dependencies ready")'
```

### 本地开发运行

开发机安装 Node.js 后可直接构建并运行。先按[数据库认证指南](docs/DATABASE_AUTH.md)准备凭据。全新的 MongoDB 数据目录需要在首次启动后、启动应用前创建数据库用户；已有数据请按指南迁移。每个终端都先导出同一份 `.env` 凭据（`set -a; source .env; set +a`），然后在项目根目录打开三个终端：

```bash
# 终端1：MongoDB，仅绑定127.0.0.1:27028
bash scripts/dev-mongo.sh
# 终端2：Redis，仅绑定127.0.0.1:6389
bash scripts/dev-redis.sh
# 终端3：构建前端并由真实OpenResty提供页面和API
(cd frontend && npm ci && npm run build)
bash scripts/dev-server.sh
```

测试环境地址为 **https://127.0.0.1:8443**，首次访问会提示本机自签名证书不受信任，确认继续即可（证书保存在 `.runtime/nginx/tls/`）。没有默认账号、预置假账目或API失败后的假数据回退。

### 部署机运行（不安装 npm）

部署机不构建前端、不需要 Node/npm。先在构建机生成发布包：

```bash
bash scripts/build-release.sh
# 产物：release/nestledger-<时间>.tar.gz 及 .sha256
```

把压缩包传到部署机，解压后配置并启动：

```bash
tar -xzf nestledger-<时间>.tar.gz
cd nestledger
cp .env.example .env && chmod 600 .env   # 填写凭据与 APP_ENV
set -a; source .env; set +a
bash scripts/dev-mongo.sh   # 终端1
bash scripts/dev-redis.sh   # 终端2
bash scripts/dev-server.sh  # 终端3
```

- 测试环境：`APP_ENV=test`，访问 `https://127.0.0.1:8443`，自签名证书自动生成。
- 发布环境：`APP_ENV=production`，访问 `https://xxx.com:8001`（`xxx.com` 为示例域名，部署时替换成自己的域名），需单独提供证书并设置 `TLS_CERT_FILE`／`TLS_KEY_FILE`。

完整的发布包内容、证书放置、数据库初始化和 systemd 常驻步骤见[部署指南](docs/DEPLOYMENT.md)。

开发脚本使用独立端口，避免复用本机已有数据库服务：MongoDB 27028、Redis 6389，业务库 `nestledger_dev`。数据及生成的配置保存在忽略提交的 `.runtime/` 目录。每个服务在前台运行，Ctrl+C停止，数据保留。

> `APP_ORIGIN` 必须与浏览器地址的origin完全相同。测试环境默认 `https://127.0.0.1:8443`；若使用 `https://localhost:8443`，需以 `APP_ORIGIN=https://localhost:8443 bash scripts/dev-server.sh` 启动。发布环境为 `https://xxx.com:8001`。HTTP 仅用于本地排障：`APP_TLS=false COOKIE_SECURE=false APP_ORIGIN=http://127.0.0.1:8443 bash scripts/dev-server.sh`。

本地Nginx日志：[访问日志](.runtime/nginx/logs/access.log)、[错误日志](.runtime/nginx/logs/error.log)。[Nginx配置模板](backend/nginx.conf)的项目路径与DNS占位符由[启动脚本](scripts/dev-server.sh)生成，不能直接用模板启动nginx。

### 配置与现有数据库

[环境变量示例](.env.example)可复制为本地 `.env`，然后在启动终端手动导出：

```bash
cp .env.example .env
set -a
source .env
set +a
bash scripts/dev-server.sh
```

也可直接使用已有的本地服务，不启动额外MongoDB／Redis进程：

```bash
MONGO_HOST=127.0.0.1 MONGO_PORT=27017 MONGO_DATABASE=nestledger \
MONGO_USERNAME=nestledger_app MONGO_PASSWORD=... MONGO_AUTH_SOURCE=nestledger \
REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=... \
  bash scripts/dev-server.sh
```

变量：`APP_ENV`、`APP_PORT`、`APP_BIND`、`APP_ORIGIN`、`APP_TLS`、`TLS_CERT_FILE`、`TLS_KEY_FILE`、`MONGO_HOST`、`MONGO_PORT`、`MONGO_DATABASE`、`MONGO_USERNAME`、`MONGO_PASSWORD`、`MONGO_AUTH_SOURCE`、`REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_DATABASE`、`COOKIE_SECURE`；`OPENRESTY_BIN`可指定OpenResty的nginx可执行文件，`DNS_RESOLVER`可覆盖本机DNS（IP地址）。全部含义见[后端说明](backend/README.md)。

### 前端热更新

构建同源运行用于完整验证；日常Vue开发另开终端：

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Vite默认5173，`/api`代理到 `https://127.0.0.1:8443`（自签名证书已放行）。由于会话 Cookie 标记了 Secure，Vite 热更新模式的 http 页面无法保存登录态；需要完整登录流程时用上面的 HTTPS 同源构建，热更新时则改用 HTTP 后端：

```bash
APP_TLS=false COOKIE_SECURE=false APP_ORIGIN=http://127.0.0.1:5173 bash scripts/dev-server.sh
API_PROXY_TARGET=http://127.0.0.1:8443 npm --prefix frontend run dev -- --host 127.0.0.1
```

如Vite端口变化，同步改origin。代理目标可通过 `API_PROXY_TARGET` 覆盖。

## 测试

```bash
# 类型检查、生产构建、前端单元／组件回归测试
(cd frontend && npm run build && npm test)
# 真实OpenResty库、BSON／时间／输入／密码及协议模块测试
bash scripts/test-backend.sh
# 本机三个服务启动后，执行真实API集成测试
python3 -m unittest discover -s tests -v
```

[API集成测试](tests/test_api.py)覆盖账号生命周期、多用户授权、会话失效、个人隔离、家庭邀请、只读分享与撤销、成员归属筛选与统计、全部账本汇总、记录CRUD、CSRF、非法金额／日期、搜索分页、并发协议请求、上海周界与闰月。仅在开发数据库运行；测试创建随机账号，账本成功测试后清理，账号保留。

对运行中的 HTTPS 应用测试时，设置 `NESTLEDGER_TEST_URL=https://127.0.0.1:8443` 和 `NESTLEDGER_ORIGIN=https://127.0.0.1:8443`。

浏览器端到端测试：

```bash
cd tests/browser
npm ci
npm run install-browser
# Linux缺少Chromium运行库时：npx playwright install-deps chromium
npm test
cd ../..
```

[浏览器测试](tests/browser/platform.spec.js)用真实服务验证桌面／手机、家庭邀请、收支、编辑删除、分析、账户设置与重新登录，检查手机页面无横向溢出并生成截图。截图中的账目为测试写入开发数据库的数据。

直接MongoDB驱动跨批次游标测试：

```bash
MONGO_HOST=127.0.0.1 MONGO_PORT=27028 MONGO_DATABASE=nestledger_dev \
  resty --main-conf 'env MONGO_HOST; env MONGO_PORT; env MONGO_DATABASE;' \
  -I backend/lua backend/tests/integration_cursor.lua
```

[游标测试](backend/tests/integration_cursor.lua)验证1205条临时文档的真实getMore、分页、原子修改、异常清理和重复索引声明，结束后自动清理。基础注册限流30次/IP/小时，重复创建测试账号可能触发429；应使用隔离测试服务，而非取消生产保护。

本次实际验证结果见[验证报告](docs/VERIFICATION.md)。

## 安全与生产边界

- 密码 PBKDF2-HMAC-SHA256、随机盐、默认600000次迭代、常量时间比较。
- HttpOnly、SameSite=Lax Cookie，Redis缓存7天会话；修改密码使其他会话失效。
- 写接口验证明确配置的Origin和JSON媒体类型，后端最终校验所有账本和记录权限。
- MongoDB驱动采用BSON＋OP_MSG直接连接。当前不提供MongoDB SCRAM认证、数据库TLS或集群选主；**MongoDB／Redis必须只绑定环回地址或受信任私网，不能公开数据库端口**。
- 注册和换绑使用短信验证码；换绑仍需当前密码。验证码由本地生成和核验，阿里云只负责发送。家庭邀请仍是站内邀请；历史账号不自动视作已验证。上线配置和隔离测试见[短信接入说明](docs/SMS.md)。
- 已有基础注册、登录和敏感修改限流；公开部署仍需HTTPS反向代理、更完善的限流／审计、监控及备份恢复。HTTPS时设置实际 `APP_ORIGIN` 和 `COOKIE_SECURE=true`。
- 单节点MongoDB未使用跨集合事务，严格生产事务／高可用部署需要进一步扩展；当前适合本机运行和可信团队试用。

## 结构与接口

- [frontend](frontend/)：Vue3页面、组件、API客户端、SVG图表、测试。
- [backend](backend/)：OpenResty模板、Lua业务、BSON／MongoDB驱动、Redis会话、测试。
- [scripts](scripts/)：本机服务启动和后端测试。
- [tests](tests/)：真实API与浏览器集成测试。
- [API_CONTRACT.md](API_CONTRACT.md)：接口、数据结构和权限约定。

API前缀 `/api`，成功 `{ "data": ... }`，错误 `{ "error": { "code": "...", "message": "..." } }`。金额 `amountCents` 为正整数；日期以ISO8601 UTC存储和传输，界面／分析按上海时区。时间范围 `[from, to)`（开始包含、结束不包含）。
