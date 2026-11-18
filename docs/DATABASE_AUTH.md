# 本地数据库认证与迁移

应用进程通过环境变量读取 `MONGO_USERNAME`、`MONGO_PASSWORD`、`MONGO_AUTH_SOURCE` 和 `REDIS_PASSWORD`。`MONGO_AUTH_SOURCE` 是创建 MongoDB 用户所在的库，不一定是 `MONGO_DATABASE`；推荐两者都设为业务库（本机默认为 `nestledger_dev`）。给应用用户该业务库的 `readWrite` 权限即可，不要使用管理员账户运行应用。Redis 启动终端和应用终端需导出同一个非空 `REDIS_PASSWORD`。凭据通过受保护的本地环境或服务管理器提供，不放在命令参数、代码或版本库中。脚本不会自动读取 `.env`。

`scripts/dev-mongo.sh` 始终启用认证并仅监听回环地址，`scripts/dev-redis.sh` 要求非空 `REDIS_PASSWORD` 并通过标准输入传入 `requirepass`，密码不会出现在进程参数中。

## 创建全新的 MongoDB 用户

1. 生成凭据并写入受保护的本地环境，例如 `.env`（权限 600）：

   ```bash
   echo "MONGO_USERNAME=nestledger_app"
   echo "MONGO_PASSWORD=$(openssl rand -hex 24)"
   echo "MONGO_AUTH_SOURCE=nestledger_dev"
   echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
   ```

2. 首次启动空实例：`bash scripts/dev-mongo.sh`。MongoDB 仅在没有任何用户时开放 localhost 初始化窗口；不要在有不可信本机用户的环境中保留这个窗口。
3. 在另一个终端导出 `MONGO_HOST`／`MONGO_PORT`，设置一次性管理员凭据后执行：

   ```bash
   export MONGO_ADMIN_USERNAME=nestledger_admin
   export MONGO_ADMIN_PASSWORD="$(openssl rand -hex 24)"   # 记录到密码管理器
   bash scripts/create-mongo-admin.sh
   bash scripts/create-mongo-app-user.sh
   ```

   第一条通过 localhost 初始化窗口创建管理员；第二条用管理员创建仅对 `MONGO_AUTH_SOURCE` 有 `readWrite` 权限的 SCRAM-SHA-256 应用用户。管理员凭据只用于初始化与维护，不写入 `.env`。
4. 为应用导出 Mongo 凭据和 Redis 密码，完整重启 Redis 与应用。MongoDB 与 Redis 均只监听 `127.0.0.1`；Redis 使用 AOF 持久化。

更多部署细节（systemd、TLS、备份恢复）见[部署指南](DEPLOYMENT.md)。

## 已运行实例：计划停机迁移

1. 确认实例、端口、数据目录、用户所在库和所有客户端。记录当前启动配置，安排停机，隔离数据库端口（包括限制不可信本机用户），停止应用及其他写入方。按数据库的备份流程做一致性备份，并确认可恢复；不要复制运行中的数据库数据目录作为备份。Redis 按实际持久化方式备份，若不保留会话则提前告知用户需要重新登录。
2. 在现有 MongoDB 实例创建专用应用用户。已启用认证的实例用现有管理员操作；尚未启用认证的实例仅在隔离后操作。不要启动第二个进程访问同一数据目录。用正确的业务库和认证库准备应用凭据。
3. 正常停止数据库实例，然后用原数据目录和端口、启用认证的配置重启 MongoDB。用原持久化目录和端口、启用默认用户密码的配置重启 Redis。若由服务管理器启动，在其受保护的配置中设置认证，不要临时替换其进程。
4. 验证未认证读写被拒绝，以及正确凭据可以完成业务库的读写和 Redis `PING`。注入应用凭据后完整重启 OpenResty（仅 reload 不会从新的启动 shell 继承环境）。验证登录、会话和账本读写后恢复流量。
5. 若验证失败，保持隔离且不恢复写入，先检查认证库、角色、密码和服务环境。必须回退时，按维护方案恢复原配置和凭据；只有确认需要恢复数据时才使用备份，避免覆盖迁移后新增数据。不要为排障在可访问的接口上关闭认证。
