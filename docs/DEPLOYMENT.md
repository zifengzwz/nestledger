# 本机部署指南

NestLedger 由 OpenResty 同时提供 Vue 静态页面和 Lua API，MongoDB 保存业务数据，Redis 保存会话与限流数据。**前端只在构建机上打包；部署机不需要 Node.js、npm，也不执行任何前端构建。**

## 1. 部署形态与环境

| 组件 | 默认地址 | 说明 |
| --- | --- | --- |
| OpenResty | 见下方环境表 | 页面、API、TLS 终止 |
| MongoDB | `127.0.0.1:27028` | 独立实例，强制 SCRAM-SHA-256 认证 |
| Redis | `127.0.0.1:6389` | 独立实例，强制密码，AOF 持久化 |
| 前端产物 | `frontend/dist/` | 由发布包提供，部署机不构建 |

通过 `APP_ENV` 选择环境；未显式设置端口／地址时使用以下默认值：

| 环境 | 访问地址 | 监听 | TLS 证书 |
| --- | --- | --- | --- |
| `test`（默认） | `https://127.0.0.1:8443` | `127.0.0.1:8443` | 首次启动自动生成自签名证书 |
| `production` | `https://zifeng.net:8001` | `0.0.0.0:8001` | **由运维单独提供**，通过 `TLS_CERT_FILE`／`TLS_KEY_FILE` 指定 |

生产环境必须保证 `zifeng.net` 解析到部署机、防火墙放行 8001，且证书包含 `zifeng.net`。测试环境只监听回环地址。

源码与运行数据分离：运行数据、生成的 Nginx 配置、TLS 证书都在 `.runtime/`（不入版本库），部署前请规划备份。

## 2. 部署机：安装运行时依赖

以下命令以 **Ubuntu 24.04（x86_64）** 为例。Debian 用户把 OpenResty 源中的 `ubuntu` 换成 `debian`，并把 MongoDB 源中的 `ubuntu` 换成 `debian`、末尾的 `multiverse` 换成 `main`；其他发行版请换用对应的软件源。版本要求：OpenResty 1.31+（不是普通 nginx）、MongoDB 5+（推荐 8.0）、Redis 7+、Python 3.10+、openssl。

### 2.1 基础工具

```bash
sudo apt-get update
sudo apt-get install -y curl wget gnupg ca-certificates lsb-release \
  openssl python3 build-essential
```

### 2.2 OpenResty

```bash
wget -O - https://openresty.org/package/pubkey.gpg | \
  sudo gpg --dearmor -o /usr/share/keyrings/openresty.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/openresty.gpg] http://openresty.org/package/ubuntu $(lsb_release -sc) main" | \
  sudo tee /etc/apt/sources.list.d/openresty.list > /dev/null

sudo apt-get update
sudo apt-get install -y openresty openresty-opm
/usr/local/openresty/nginx/sbin/nginx -v
# nginx version: openresty/1.31.8.1
```

安装 Lua 模块（密码哈希与阿里云短信）：

```bash
sudo apt-get install -y luarocks
sudo luarocks install lua-resty-openssl
sudo opm get ledgetech/lua-resty-http
```

### 2.3 MongoDB

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu $(lsb_release -sc)/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list > /dev/null

sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl disable --now mongod   # 项目使用独立实例 27028/.runtime/mongo
mongod --version | head -1
```

若 CPU 不支持 AVX，官方 8.0 二进制无法启动，可改用 MongoDB 5.0／6.0 或源码包；版本 ≥5.0 即可。

### 2.4 Redis

```bash
sudo apt-get install -y redis-server
sudo systemctl disable --now redis-server   # 项目使用独立实例 6389
redis-server --version
# Redis server v=7.0.15
```

发行版自带 Redis 低于 7 时，请按 [Redis 官方文档](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/) 安装。

### 2.5 依赖自检

```bash
python3 -V && openssl version
/usr/local/openresty/nginx/sbin/nginx -v
mongod --version | head -1
redis-server --version
resty -e 'require("resty.redis"); require("resty.lock"); require("resty.openssl.kdf"); require("resty.http"); print("deps ok")'
```

最后一行输出 `deps ok` 才表示 OpenResty 侧依赖齐全。部署机到这里为止，**不需要安装 Node.js 或 npm**。

## 3. 构建机：生成前端与发布包

在可联网、已安装 **Node.js 22.12+ 或 24 LTS 与 npm** 的机器上（可以是开发机，不必是部署机）：

```bash
cd NestLedger
bash scripts/build-release.sh
```

脚本会执行 `npm ci`、`npm run build`，并把运行所需内容打包：

```
release/nestledger-<时间>.tar.gz
release/nestledger-<时间>.tar.gz.sha256
```

发布包包含 `backend/`、`frontend/dist/`、`scripts/`、`docs/`、`tests/`、`API_CONTRACT.md`、`README.md`、`.env.example`，不包含 `node_modules`、`.env`、`.runtime` 或任何开发依赖。部署机解压后即可运行，无需再执行 npm。

把压缩包和校验文件一起传到部署机，部署前校验完整性：

```bash
sha256sum -c nestledger-<时间>.tar.gz.sha256
```

> 修改前端代码后必须重新在构建机运行 `scripts/build-release.sh` 并重新上传；部署机上没有源码构建能力。

## 4. 部署机：解压与配置

```bash
tar -xzf nestledger-<时间>.tar.gz
cd nestledger
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少设置：

```dotenv
APP_ENV=production            # production 或 test
APP_ORIGIN=https://zifeng.net:8001   # production；test 为 https://127.0.0.1:8443
APP_TLS=true
COOKIE_SECURE=true

MONGO_HOST=127.0.0.1
MONGO_PORT=27028
MONGO_DATABASE=nestledger_dev
MONGO_USERNAME=nestledger_app
MONGO_PASSWORD=<Mongo 应用密码>
MONGO_AUTH_SOURCE=nestledger_dev

REDIS_HOST=127.0.0.1
REDIS_PORT=6389
REDIS_DATABASE=0
REDIS_PASSWORD=<Redis 密码>
```

各值可用 `openssl rand -hex 24` 生成，三个密码互不相同。`APP_ORIGIN` 必须和浏览器地址栏的 origin 完全一致（协议、主机名、端口），生产环境为 `https://zifeng.net:8001`。

### 4.1 生产环境证书（单独提供）

生产环境不生成自签名证书，需把证书单独放到部署机并指向它：

```bash
sudo mkdir -p /etc/nestledger/tls
sudo install -m 644 fullchain.pem /etc/nestledger/tls/fullchain.pem
sudo install -m 600 privkey.pem   /etc/nestledger/tls/privkey.pem
```

在 `.env` 中增加：

```dotenv
TLS_CERT_FILE=/etc/nestledger/tls/fullchain.pem
TLS_KEY_FILE=/etc/nestledger/tls/privkey.pem
```

要求证书链包含中间证书、SAN 含 `zifeng.net`，私钥权限 600。若用 systemd 的普通用户运行 OpenResty，需让该用户可读私钥，例如：

```bash
sudo chown nestledger:nestledger /etc/nestledger/tls/privkey.pem
sudo chmod 600 /etc/nestledger/tls/privkey.pem
```

证书或私钥缺失、不可读时应用拒绝启动。

### 4.2 测试环境证书

`APP_ENV=test` 且未设置 `TLS_CERT_FILE`／`TLS_KEY_FILE` 时，首次启动自动在 `.runtime/nginx/tls/` 生成自签名证书（SAN 含 `localhost`、`127.0.0.1`），浏览器提示证书不受信任属正常现象。

## 5. 初始化数据库

全新数据目录先启动带认证的 MongoDB：

```bash
set -a; source .env; set +a
bash scripts/dev-mongo.sh
```

此时实例还没有任何用户，MongoDB 的 localhost 初始化窗口允许创建第一个管理员。另开终端导出同一份环境（`set -a; source .env; set +a`），再设置一次性管理员凭据后执行：

```bash
export MONGO_ADMIN_USERNAME=nestledger_admin
export MONGO_ADMIN_PASSWORD="$(openssl rand -hex 24)"   # 记录到密码管理器
bash scripts/create-mongo-admin.sh
bash scripts/create-mongo-app-user.sh
```

第一条命令通过 localhost 初始化窗口创建管理员；第二条用管理员创建仅对业务库有 `readWrite` 权限的 SCRAM-SHA-256 应用用户，密码取自 `.env`。管理员凭据只用于初始化与维护，不写入 `.env`。

启动 Redis：

```bash
set -a; source .env; set +a
bash scripts/dev-redis.sh
```

密码通过标准输入传给 `requirepass`，不会出现在进程参数中。验证无凭据访问被拒绝：

```bash
redis-cli -p 6389 ping        # NOAUTH Authentication required
```

> 如果数据目录里已经有用户，初始化窗口已关闭；请使用现有管理员执行 `create-mongo-app-user.sh`，或按 [数据库认证指南](DATABASE_AUTH.md) 的迁移步骤操作。

## 6. 启动应用

```bash
set -a; source .env; set +a
bash scripts/dev-server.sh
```

启动脚本会按 `APP_ENV` 生成监听地址：

- `test`：`listen 127.0.0.1:8443 ssl`，访问 `https://127.0.0.1:8443`。
- `production`：`listen 0.0.0.0:8001 ssl`，访问 `https://zifeng.net:8001`。

生产环境需要确认 DNS、防火墙（只放行必要来源）和证书三件事；仅本地排障才临时关闭 TLS：

```bash
APP_TLS=false COOKIE_SECURE=false APP_ORIGIN=http://127.0.0.1:8001 bash scripts/dev-server.sh
```

## 7. 验证部署

```bash
# 生产：证书可信时直接访问；测试环境用 -k 跳过自签名校验
curl -fsS  https://zifeng.net:8001/api/health
curl -fsk  https://127.0.0.1:8443/api/health
# 期望 {"data":{"mongo":true,"redis":true,"status":"ok"}}
```

再确认：

1. 页面能打开，静态资源加载正常，无控制台报错。
2. 注册、登录、退出可用；登录 Cookie 带 `Secure`。
3. 新建账本、记一笔收支，刷新后数据仍在。
4. 错误密码登录返回 401，跨站 Origin 的写请求被拒绝。
5. 生产环境浏览器地址栏显示证书有效；测试环境接受自签名提示。

可选自动化回归（使用临时数据库，不影响正式数据，且只能在有 Node 的构建机跑浏览器测试）：

```bash
python3 tests/run_isolated.py
```

## 8. 短信（注册、换绑、重置密码）

注册与找回密码依赖短信发送。未配置时这些功能会拒绝，密码登录不受影响。填写：

```dotenv
SMS_HMAC_KEY=<openssl rand -hex 32>
ALIYUN_ACCESS_KEY_ID=<仅短信权限的 AccessKey>
ALIYUN_ACCESS_KEY_SECRET=<对应 Secret>
ALIYUN_SMS_SIGN_NAME=<已审核签名>
ALIYUN_SMS_REGISTER_TEMPLATE_CODE=<注册模板 CODE>
ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE=<换绑模板 CODE>
ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE=<重置密码模板 CODE>
```

要求：

- 阿里云 RAM 用户只授予号码认证发送权限，并确认服务已开通、签名和模板已审核。
- 模板变量使用 `code`，可在模板中附加 `min`（值 5）表示 5 分钟有效。
- 服务器需能访问阿里云 HTTPS 接口，并具备系统 CA 信任包（默认读取 `/etc/ssl/certs/ca-certificates.crt`）。
- 修改短信环境变量后必须**完整重启** OpenResty，reload 不会让 worker 读取新的启动环境。

验证码为本地生成的六位数字，5 分钟有效、最多 5 次错误尝试；同一手机号跨用途 60 秒限流，每 IP 每小时最多 10 次发送尝试，注册另有每小时 30 次限制。不会调用阿里云校验接口。详见 [短信说明](SMS.md)。

## 9. 数据备份与恢复

| 路径 | 内容 |
| --- | --- |
| `.runtime/mongo/` | 全部业务数据 |
| `.runtime/redis/` | 会话、限流、验证码（AOF） |
| `.runtime/nginx/tls/` | 测试环境的自签名证书和私钥 |
| `/etc/nestledger/tls/` | 生产证书和私钥（单独保存） |
| `.env` | 数据库与短信凭据（单独加密保存） |

### 冷备份（推荐）

```bash
# 停止三个服务（前台运行的终端 Ctrl+C，或 systemctl stop）
tar -czf nestledger-backup-$(date +%F).tar.gz \
  .runtime/mongo .runtime/redis .runtime/nginx/tls
```

冷备份一致性最好；不要在服务运行时直接复制 Mongo 数据目录作为唯一备份。备份里含私钥，请加密保存并限制访问。

### 恢复

1. 停止三个服务，保留当前 `.env` 和证书。
2. 把备份中的 `.runtime/mongo`、`.runtime/redis` 放回原位。
3. 按第 5、6 节顺序启动：先 MongoDB、Redis，再应用。
4. 访问 `/api/health` 并登录，确认数据完整；必要时再次冷备份当前状态。

## 10. 使用 systemd 常驻（可选）

三个单元都以普通用户运行，`EnvironmentFile` 指向 600 权限的 `.env`；该用户需要对代码目录和 `.runtime/` 有读写权限。

```ini
# /etc/systemd/system/nestledger-mongo.service
[Unit]
Description=NestLedger MongoDB
After=network.target

[Service]
Type=simple
User=nestledger
WorkingDirectory=/opt/nestledger
EnvironmentFile=/opt/nestledger/.env
ExecStart=/opt/nestledger/scripts/dev-mongo.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/nestledger-redis.service
[Unit]
Description=NestLedger Redis
After=network.target

[Service]
Type=simple
User=nestledger
WorkingDirectory=/opt/nestledger
EnvironmentFile=/opt/nestledger/.env
ExecStart=/opt/nestledger/scripts/dev-redis.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/nestledger-app.service
[Unit]
Description=NestLedger OpenResty
After=network.target nestledger-mongo.service nestledger-redis.service

[Service]
Type=simple
User=nestledger
WorkingDirectory=/opt/nestledger
EnvironmentFile=/opt/nestledger/.env
ExecStart=/opt/nestledger/scripts/dev-server.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nestledger-mongo nestledger-redis nestledger-app
systemctl status nestledger-app
journalctl -u nestledger-app -f
```

修改 `.env` 后需 `systemctl restart` 全部三个服务；应用必须完整重启才能继承新凭据。

## 11. 升级与回滚

1. 构建机重新运行 `scripts/build-release.sh`，生成新的发布包并校验。
2. 备份 `.runtime/` 与 `.env`。
3. 部署机停止应用（不必停数据库）。
4. 解压新包到临时目录，用其中的 `backend/`、`frontend/dist/`、`scripts/` 覆盖旧目录；保留 `.env`、`.runtime/` 和证书。
5. 启动应用，按第 7 节验证。
6. 失败时用旧发布包覆盖回去并重启；数据目录未改动，无需回滚数据库。

## 12. 日志与排障

| 位置 | 用途 |
| --- | --- |
| `.runtime/nginx/logs/error.log` | API 错误、数据库与短信依赖日志 |
| `.runtime/nginx/logs/access.log` | 请求记录 |
| `journalctl -u nestledger-app` | systemd 运行输出 |

| 现象 | 原因与处理 |
| --- | --- |
| 启动报 `frontend/dist/index.html is missing` | 使用了未打包的源码；改用 `scripts/build-release.sh` 生成的发布包 |
| 生产启动报需要 `TLS_CERT_FILE`／`TLS_KEY_FILE` | 未提供生产证书；按 4.1 放置并指向证书 |
| 浏览器提示证书错误（生产） | 证书未包含 `zifeng.net`、链不完整或配错文件 |
| `/api/health` 返回 503 或 `mongo:false` | 应用环境缺少 `MONGO_USERNAME`／`MONGO_PASSWORD`，或认证库不对；完整重启 |
| 页面能开但登录一直失败 | Redis 密码不一致；Redis 与应用必须使用同一个 `REDIS_PASSWORD`，并一起重启 |
| 写操作返回 403 | `APP_ORIGIN` 与浏览器地址不完全一致（协议、主机、端口） |
| 登录后刷新即掉线 | HTTPS 场景下 `COOKIE_SECURE=false` 或实际用 HTTP 访问 |
| 短信发送失败 / 日志 403 `Forbidden.NoPermission` | RAM 授权、服务开通、签名模板或 AccessKey 身份不匹配；见 [短信说明](SMS.md) |
| 启动报端口占用 | 已有旧进程；`ss -ltnp` 找到后停止再启动 |
| 模板启动报占位符 | 不要直接用 `backend/nginx.conf` 启动，必须通过 `scripts/dev-server.sh` |

## 13. 安全清单

- `.env` 权限 600，密钥与密码不进 Git、不出现在命令行参数；数据库密码互不复用。
- 生产证书私钥权限 600；只通过 `TLS_CERT_FILE`／`TLS_KEY_FILE` 引用，不放进版本库。
- MongoDB、Redis 仅监听 `127.0.0.1` 并保持认证开启；不要为排障临时关闭认证。
- 应用使用最小权限 Mongo 账号（`readWrite` 于业务库），管理员账号只用于维护。
- 生产只开放 8001，限制来源 IP；`COOKIE_SECURE=true`、`APP_ORIGIN=https://zifeng.net:8001`。
- `PBKDF2_ITERATIONS` 保持默认 600000 或更高，生产不要调低。
- 部署机不安装 Node/npm；不要向不可信网络暴露 Vite 开发服务器（5173）或数据库端口。
- 定期冷备份并演练恢复；升级或改配置前先备份。
- 定期检查 `.runtime/nginx/logs/error.log`，关注认证失败、短信 403 与 5xx。
