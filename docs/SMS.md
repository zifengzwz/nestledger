# 阿里云短信验证码配置

注册和更换手机号需要短信验证码，现有密码登录不变。阿里云 Dypnsapi 只调用 `SendSmsVerifyCode`，模板必须允许传入自定义 `code`；不使用占位符 `##code##`，不调用核验接口。默认模板参数为 `{"code":"<本地生成的六位数字>","min":"5"}`，签名与模板必须配套。

1. 在号码认证控制台开通短信认证、确定实际可用的签名和模板，并给服务端 RAM 身份授权发送接口（`dypns:SendSmsVerifyCode`）。不要使用主账号密钥。
2. 安装 OpenResty 的 `lua-resty-http` 库和系统 CA 证书包，确保服务端 DNS 与到 `dypnsapi.aliyuncs.com:443` 的连接可用。
3. 参考[环境变量示例](../.env.example)填写仅服务端可读的环境文件。用 `openssl rand -hex 32` 生成独立的 `SMS_HMAC_KEY`，另外配置阿里云凭据、签名和两个模板：`ALIYUN_SMS_REGISTER_TEMPLATE_CODE=100001`、`ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE=100002`。当前登录仍只用密码。不要提交真实值或发到聊天里。导出环境变量后重启 OpenResty **主进程**；仅 reload 不会重新读取启动时的环境变量。
4. 未配置时，发送、注册和换绑返回服务不可用，不回退到无验证码流程。历史账号仍可使用密码登录，不自动证明手机号归属。家庭邀请仍是站内邀请。

## 限流与验证

验证码六位数字，5 分钟有效；每个手机号跨场景共享 60 秒冷却，发送请求另有 IP 限额。Redis 只保存绑定手机号／用途／换绑账号的验证码 HMAC 摘要。最多尝试 5 次，核验通过即原子消费。发送超时不自动重试，也不提前释放冷却，避免重复发送。

## 测试（不发送短信）

运行 `python3 backend/tests/run_sms.py`：使用临时 Redis 和模拟发送。构建前端后运行 `python3 tests/run_isolated.py` 可自动启动独立服务并跑业务 API 与浏览器回归；如手动测试，需启动独立的本机 OpenResty、MongoDB、Redis，使用独立端口、测试 HMAC 密钥和不可用的阿里云占位凭据。测试 Redis 同时提供私有 Unix socket（DB 0）。设置 `NESTLEDGER_TEST_URL`、`NESTLEDGER_TEST_REDIS_SOCKET`、`NESTLEDGER_TEST_SMS_HMAC_KEY`（和测试服务的密钥相同），然后运行 Python 集成测试和 Playwright。测试夹具直接在隔离 Redis 准备一次性挑战，不调用发送接口，也没有生产测试绕过。
