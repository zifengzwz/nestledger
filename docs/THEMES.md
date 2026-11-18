# 界面色调

小家有账内置 **11 套配色**：4 套沉稳自然、4 套明亮鲜艳、3 套高对比度。登录后可在 **账户与安全 → 界面色调** 中随时切换，点选即时生效。

| 色调 | 特点 | 主色 | 预览 |
| --- | --- | --- | --- |
| 陶土暖棕（默认） | 温润、安静 | `#965438` | [预览](screenshots/theme-clay-desktop.png) |
| 森林青绿 | 清新、自然 | `#2f6b4f` | [预览](screenshots/theme-forest-desktop.png) |
| 雾蓝浅灰 | 冷静、清爽 | `#386d96` | [预览](screenshots/theme-blue-desktop.png) |
| 烟紫暮色 | 柔和、沉静 | `#7a4f7c` | [预览](screenshots/theme-plum-desktop.png) |
| 珊瑚橙 | 明快、有活力 | `#e0583a` | [预览](screenshots/theme-coral-desktop.png) |
| 芒果黄 | 晴朗、醒目 | `#e29410` | [预览](screenshots/theme-mango-desktop.png) |
| 薄荷青 | 清爽、鲜亮 | `#0f9c8e` | [预览](screenshots/theme-mint-desktop.png) |
| 莓果红 | 浓郁、俏皮 | `#c9256a` | [预览](screenshots/theme-berry-desktop.png) |
| 高对比·黑白 | 墨黑强调 | `#171717` | [预览](screenshots/theme-contrast-ink-desktop.png) |
| 高对比·海军蓝 | 深蓝强调 | `#123969` | [预览](screenshots/theme-contrast-navy-desktop.png) |
| 高对比·深酒红 | 酒红强调 | `#731b37` | [预览](screenshots/theme-contrast-wine-desktop.png) |

新主题保持白底黑字，加深控件边框与焦点标识。

手机端同样可以选择：[烟紫手机预览](screenshots/theme-plum-mobile.png)。

## 交互与保存

- 在账户页的「界面色调」中点击色卡，页面立刻换色，无需刷新。
- 选择会保存到**当前账号**（MongoDB `users.theme`），换设备、重新登录或更换浏览器后自动沿用。
- 同时写入浏览器本地缓存，进入登录页前就应用上次的色调，避免先闪一下默认色。
- 保存失败（例如网络中断）会恢复原色调并提示；本地缓存损坏或不可用时回退默认色调，不影响使用。
- 支持键盘：方向键/Home/End 在色卡间切换，选中项有焦点环与勾选标记。

## 配色实现方式

界面颜色通过 CSS 设计变量（`frontend/src/style.css` 的 `:root` 与 `:root[data-theme=...]`）控制，切换主题只改 `<html data-theme>` 属性：

- 主操作、导航、焦点：`--accent`、`--accent-strong`、`--accent-light`；填充按钮与品牌使用更深的 `--accent-fill`，保证鲜艳色调下白字仍然清晰
- 纸面与文字：`--surface`、`--surface-raised`、`--page`、`--text`、`--muted`、`--border`
- 语义色：`--income`（收入）、`--expense`（支出）、`--danger`（删除/危险）
- 结余卡：`--balance-deep/mid/hi/text/muted`

浅色底纹通过 `color-mix(in srgb, var(--accent) N%, var(--surface))` 从主色派生，因此新主题无需逐个指定 180 多个颜色。图表折线、分类色条和图标同样跟随主题。

### 新增一套主题

1. 在 `:root[data-theme="mytheme"]` 中定义上述变量（可参考现有四套的值）。
2. 在 `frontend/src/theme.ts` 的 `THEMES` 中登记 `id`、名称、提示与色卡颜色。
3. 后端 `theme` 枚举（`backend/lua/nestledger/api.lua` 的 `theme_change`）加入同一 `id`，并补充测试。
4. 运行 `npm --prefix frontend run build && npm --prefix frontend test`，再在 `tests/browser` 执行 `npm test`。

## 验证

- 前端 193 项测试，含 8 套主题令牌校验、非法值回退、本地存储异常、色卡键盘操作与账号同步。
- 真实浏览器 [themes.spec.js](../tests/browser/themes.spec.js)：逐一切换八套色调，检查 `data-theme`、接口保存、四个主色互不相同、关键文字对比度、侧栏宽度与筛选 40px 不变、手机无横向溢出、跨设备登录沿用、本地缓存损坏回退。
- 后端 11 组 API 测试覆盖主题默认值、四种值持久化、跨登录保留、非法值、用户隔离、不轮换会话等。

## 文字统一黑色

无论选择哪套色调，**正文、标题、金额数字、表格与表单文字都使用近黑色**（`#111111` / `#1f1f1f`，次要文字中性灰 `#5b5b5b`、`#6a6a6a`），主题色只用于按钮填充、图标、背景浅底、图表折线、选中标识和装饰边框。结余卡为深色底，使用白色文字。错误提示为语义红色。

因此换色调只改变“气氛色”，不会让正文变成棕色、蓝色或紫色，也不会降低可读性。

## 对比度基线（2026-11-18 提高）

针对反馈"对比度不高、看着不舒服"，统一做了以下调整：

| 项目 | 调整前 | 调整后 |
| --- | --- | --- |
| 正文文字 | 主题色调墨色 | **近黑色，约 15–19:1** |
| 次要文字 `--muted` | 4.6–5.9:1 | **5.7–7.9:1** |
| 更淡辅助文字 `--text-soft` | 4.4–4.9:1 | **5.5–7.1:1** |
| 结余卡小字（高光区） | 4.0–4.4:1（部分不达标） | **4.9–7.9:1** |
| 收入金额 | 蓝主题仅 3.5:1 | 新增 `--income-text`，**≥5.4:1** |
| 卡片边框 | 1.3–1.4:1 | **1.65–1.9:1** |
| 基础字号 / 行高 | 14px / 1.55 | **15px / 1.6** |
| 小字（眉标、表格日期、支付标签、页脚） | 10–11px | 11–12px |
| 卡片纸面 | 带色近白 | **纯白**，页面底色更淡 |

自动审计（真实浏览器逐主题采样 34 类文字元素）显示 8 套主题**全部达到 4.5:1 以上**，最低约 4.9:1；正文、导航、表格、按钮、结余卡均无低对比项。正文统一黑色后，主要文字对比度提升到 15:1 以上。

## 说明

主题只影响观感，不改变数据、权限与布局尺寸（账本五行、筛选 40px、手机金额列固定等保持不变）。若后续新增主题，请同时检查对比度与浅底深字搭配。
