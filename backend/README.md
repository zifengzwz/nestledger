# NestLedger OpenResty 后端

主服务由 OpenResty 执行 Lua API；直接使用 cosocket 连接 MongoDB 与 Redis，无 Node/Python 运行时后端替代。接口定义见[共享契约](../API_CONTRACT.md)，完整启动步骤见[项目说明](../README.md)。

## 模块

- [api.lua](lua/nestledger/api.lua)：路由、身份认证、所有权／成员权限、业务输入及响应、邀请、记录和分析。
- [transfer.lua](lua/nestledger/transfer.lua)：安全六字段导出、全批预校验、Mongo幂等回执、分块追加与批次失败恢复。
- [bson.lua](lua/nestledger/bson.lua)：BSON编解码，区分数组、文档、null，无损保留 int64 游标；有序文档保持复合索引与排序的键优先级。
- [mongo.lua](lua/nestledger/mongo.lua)：OP_MSG、连接池、原子 findAndModify、唯一索引、跨批次 getMore、异常 killCursors。
- [session.lua](lua/nestledger/session.lua)：Redis会话与基于Redis的接口限流。
- [crypto.lua](lua/nestledger/crypto.lua)：密码 PBKDF2-HMAC-SHA256、随机盐、常量时间比较；默认600000次迭代。
- [date.lua](lua/nestledger/date.lua)：不依赖服务器时区的公历转换和上海自然周／月／年。
- [validate.lua](lua/nestledger/validate.lua)：字段白名单、UTF8字符数、整数分、手机号和日期验证。
- [nginx.conf](nginx.conf)：同源静态应用、JSON API、请求大小限制及基础安全响应头。

## 环境变量

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| MONGO_HOST / MONGO_PORT | 127.0.0.1 / 27028 | 私网MongoDB地址 |
| MONGO_DATABASE | nestledger_dev | 业务数据库 |
| MONGO_USERNAME / MONGO_PASSWORD | 无 | 应用数据库凭据；部署时必须设置 |
| MONGO_AUTH_SOURCE | admin | 凭据所在认证库；推荐与业务库一致 |
| REDIS_HOST / REDIS_PORT | 127.0.0.1 / 6389 | Redis会话与限流 |
| REDIS_PASSWORD | 无 | Redis密码，必须与Redis启动值一致 |
| REDIS_DATABASE | 0 | Redis逻辑数据库 |
| APP_ENV | test | test：`127.0.0.1:8443` 自签名；production：`0.0.0.0:8001`，需单独提供证书 |
| APP_PORT | 8443 / 8001 | 按APP_ENV的默认端口 |
| APP_BIND | 127.0.0.1 / 0.0.0.0 | 监听地址 |
| APP_ORIGIN | 按APP_ENV | 浏览器允许的唯一写入origin；production为`https://xxx.com:8001` |
| APP_TLS | true | 关闭仅用于本地HTTP排障 |
| TLS_CERT_FILE / TLS_KEY_FILE | 无 | 生产证书链与私钥路径，必须可读 |
| COOKIE_SECURE | 按APP_TLS | HTTPS部署必须为true |
| PBKDF2_ITERATIONS | 600000 | 允许100000..2000000；生产不应降低默认值 |
| SMS_HMAC_KEY | 无 | 独立高熵密钥，至少32字节；例如 `openssl rand -hex 32`，所有 worker 使用同一密钥 |
| ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET | 无 | 仅授予发送权限的阿里云 RAM 凭证 |
| ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_REGISTER_TEMPLATE_CODE / ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE | 无 | 已获批准的签名及号码认证短信模板（自定义 `code`，可用 `min` 表示5分钟） |

短信配置缺失时发送、注册和换绑均拒绝，手机号密码登录不变。生产发送依赖 `lua-resty-http`（如 `luarocks install lua-resty-http`）、可用 DNS 及系统 CA 信任包（配置默认 Debian 系路径 `/etc/ssl/certs/ca-certificates.crt`）。仅用 HTTPS 调用 `SendSmsVerifyCode`，不使用阿里云校验接口。

`POST /api/auth/sms/send` 接受 `{phone,purpose}`，返回 `{data:{retryAfter:60}}`；`phone_change` 需要登录，并绑定当前账号。注册和换绑提交六位字符串 `smsCode`，换绑先校验当前密码，注册和换绑均在消费前检查目标手机号是否已存在。成功发送后验证码有效5分钟，最多5次错误尝试，Redis 原子验证并一次性消费。手机号跨用途60秒限流，发送尝试每IP每小时最多10次（含命中手机号冷却的尝试）；供应商失败不激活新验证码，也不撤销限流。注册另有限流30次/IP/小时；登录50次/IP/15分钟、15次/手机号/15分钟；账户敏感更新15次/用户/15分钟。

登录令牌为256位随机值，Cookie属性 HttpOnly、SameSite=Lax、Path=/，有效期7天。Redis保存uid和账户版本，修改密码原子递增 MongoDB 中的账户版本，使其他会话失效。敏感修改不能通过缓存身份绕过数据库权限检查。

业务删除先标记账本不可访问，再清理记录及邀请，失败后可重试删除。数据库为独立Mongo实例，未使用跨集合事务；需要更严格的事务保证时，应切换为 replica set 并扩展驱动事务支持。

## 账号界面主题

`users.theme` 保存 `clay`／`forest`／`blue`／`plum`／`coral`／`mango`／`mint`／`berry`，缺省按 `clay` 返回。`GET /auth/me` 在用户对象中带 `theme`；`PATCH /auth/settings` `{theme}` 仅更新该字段并返回用户，使用 `authVersion` 作身份守卫但不递增版本、不轮换会话，因此其它设备的登录保持有效。非法值、未知字段、非JSON、跨站来源均拒绝。

## 自定义记账选项

`GET /api/record-options`返回默认项与当前账号自定义项合并后的收入分类、支出分类和支付方式；`POST /api/record-options`接受 `kind`（expenseCategory／incomeCategory／paymentSource）与 `name`，可额外提交白名单图标ID `icon`；新增后返回完整选项与 `icons` 名称→图标映射、201。省略图标仍兼容旧客户端，按类型回退tag／coins／wallet。

MongoDB `users.customOptions`分别存储三种BSON数组，收入／支出不混用，不影响其他用户或历史记录。名称trim后1–40个UTF8字符；默认／自定义重复409，三种各最多50个。原子更新同时检查账户版本、重复名称和容量，防止并发重复及超额；现有登录、Origin与JSON验证仍适用。图标元数据存 `users.customOptionIcons` 的三种BSON数组，每项 `{name,icon}`，与名称原子写入；不把用户输入名称作为Mongo字段键，包含点／美元符号的名称也安全支持。只允许35个本地图标ID，不接受SVG内容或外部URL，图标偏好仅当前账号可见。

## 账本排序

`PATCH /api/books/order`接收当前账号全部可访问账本ID组成的有序 `bookIds` JSON数组。偏好以BSON数组存入MongoDB当前用户的 `bookOrder`，不改变账本数据和其他家庭成员的排序，不使用Redis或客户端localStorage作为排序存储。

`GET /api/books`先返回保存的顺序，新创建或新加入的账本按默认创建时间倒序追加，已删除／失去权限的历史ID忽略。数组格式、重复ID、身份与可访问集合有严格校验；不可访问ID返回403，列表变化返回409并提示刷新。

## 账本备份与批量导入

`GET /api/books/:id/export`支持from/to日期范围，按发生时间／ID升序输出最多5000条六字段记录，过滤身份与账本访问权限，不导出内部ID、账户设置和成员信息。`POST /api/books/:id/import`仅该路由允许10MiB JSON，其余API维持16KiB。大body读取／解析前先验证会话与账本访问；1–5000条记录全批预校验，dryRun不写业务记录或回执。

MongoDB `importReceipts`以用户＋账本＋requestId唯一索引保护幂等，SHA256指纹按固定六字段tuple序列生成，归一化后相同内容可重放，不同内容409。每批最多100条有序BSON插入，生成内部importBatchId；失败仅清理当前用户／账本／批次，回执retryable／rollback_pending可用相同token恢复。旧记录不会覆盖，回执不使用Redis。

本机standalone Mongo没有跨集合事务：处理中部分记录可能可见；硬崩溃遗留processing不自动lease接管，返回409 IMPORT_IN_PROGRESS，避免旧worker复活与恢复请求互相误删。运维须先确认旧执行已停止，再检查回执和batch，确认全量已完成且授权检查已通过才标committed，否则标rollback_pending交由同token重试清理。不可盲目重置token／删除committed数据。回执提交确认丢失时不回滚可能已提交批次；依赖故障明确报告。详见[API契约](../API_CONTRACT.md)。

## 驱动边界

当前支持 MongoDB 5+ 的直接 OP_MSG 请求（推荐7），无数据库 TLS、SCRAM、拓扑发现、replica-set选主、压缩或change streams，仅适合本机环回地址或可信隔离的单节点MongoDB私网。数据库端口不能公开。金额及普通业务数据在安全整数范围内，Mongo游标 int64 以原始8字节保留，不经过Lua double转换。

复合索引和复合排序必须用 `bson.ordered({{'field1',1},{'field2',-1}})`，不能用普通无序Lua table；否则不同worker或重启后会导致同名索引冲突或排序优先级改变。

## 测试

`python3 backend/tests/run_sms.py` 启动一次性的本地 Redis，使用 OpenResty `resty` 运行[短信模块测试](tests/sms.lua)。测试只使用 mock transport 和假凭证，不访问阿里云、不发短信。用真实 Redis 验证摘要、TTL、限流、账号与用途绑定、失败次数和并发一次性消费。不要给公开 HTTP 服务注入测试传输；其他业务集成测试若需创建用户，应在隔离的测试 MongoDB 中预置账号（用真实密码哈希）后走登录。

[unit.lua](tests/unit.lua) 使用真实OpenResty库并用socket mock验证协议，覆盖BSON、有序文档、日期、输入校验与密码哈希。通过[测试脚本](../scripts/test-backend.sh)运行。

[integration_cursor.lua](tests/integration_cursor.lua) 在真实开发MongoDB中插入1205条临时文档，验证跨批次游标、分页、原子修改、索引可重复声明及异常游标清理，结束后清理临时文档。仅接受数据库名以 `_dev` 或 `_test` 结尾。

[API集成测试](../tests/test_api.py) 使用真实OpenResty、MongoDB与Redis覆盖完整业务与多用户权限、5000条／大JSON导入、导出与并发幂等。密码哈希不会被mock或降级为明文。

[integration_transfer.lua](tests/integration_transfer.lua) 使用真实开发MongoDB写入、批次清理和回执，仅模拟批量写入ack丢失／rollback依赖不可用／committed回执ack丢失。验证旧记录不受影响、rollback_pending可同token恢复、完成回执重放／冲突及processing不冒险接管；结束清理生成ID的测试数据。运行：`MONGO_PORT=27028 MONGO_DATABASE=nestledger_dev resty -I backend/lua backend/tests/integration_transfer.lua`。
