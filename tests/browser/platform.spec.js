import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { smsCode } from "./sms-fixture.mjs";
const password = "Browser-NestLedger-2026!";
const phone = () => `138${String(randomInt(100000000)).padStart(8, "0")}`;
const screenshotDir = new URL("../../docs/screenshots/", import.meta.url)
  .pathname;

async function dismissToasts(page) {
  const buttons = page.getByRole("button", { name: "关闭通知", exact: true });
  while (await buttons.count()) await buttons.first().click();
}

async function register(page, number, name) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("你的称呼").fill(name);
  await page.getByLabel("手机号", { exact: true }).fill(number);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByLabel("短信验证码").fill(smsCode(number));
  await page.getByRole("button", { name: "注册并开启记账" }).click();
  await expect(
    page.getByRole("heading", { name: "生活有数，心里有底" }),
  ).toBeVisible();
}

async function createBook(page, name, family = false) {
  await page
    .getByRole("button", { name: "新建账本", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("账本名称").fill(name);
  if (family) await modal.getByLabel("家庭账本").check();
  await modal.getByRole("button", { name: "创建账本", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByLabel("当前账本")).toContainText(name);
}

async function record(page, { type = "expense", amount, category, note }) {
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("button", {
      name: type === "income" ? "收入" : "支出",
      exact: true,
    })
    .click();
  await modal.getByLabel("金额（元）", { exact: true }).fill(amount);
  await modal
    .getByRole("combobox", { name: "大分类", exact: true })
    .fill(category);
  await modal.getByPlaceholder("为这笔记录留下一点生活的细节").fill(note);
  await modal.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.locator(".records-card tbody").getByText(note, { exact: true }),
  ).toBeVisible();
}

test("真实服务：家庭记账、个人隔离、邀请、记录编辑删除、分析与账号设置", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(screenshotDir, { recursive: true });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回到小家" }),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/login.png`, fullPage: true });
  const ownerPhone = phone(),
    memberPhone = phone();
  await register(page, ownerPhone, "小家体验用户");
  await createBook(page, "小家的生活", true);
  await record(page, {
    amount: "38.50",
    category: "餐饮美食",
    note: "一家人的暖心晚餐",
  });
  await record(page, {
    type: "income",
    amount: "12000.00",
    category: "工资薪酬",
    note: "认真工作的回响",
  });
  await record(page, {
    amount: "128.80",
    category: "日用百货",
    note: "周末添置生活用品",
  });
  await expect(page.locator(".stats-grid")).toContainText("12,000.00");
  await expect(page.locator(".stats-grid")).toContainText("167.30");
  await dismissToasts(page);
  await page.screenshot({
    path: `${screenshotDir}/dashboard-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "收支明细", exact: true }).click();
  await page.getByLabel("搜索记录").fill("暖心");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.locator(".records-card tbody tr")).toHaveCount(1);
  const row = page.locator(".records-card tbody tr").first();
  await row.getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByLabel("金额（元）", { exact: true })
    .fill("40.00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存修改" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(row).toContainText("40.00");
  await row.getByRole("button").last().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除记录", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "这里还没有记录" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.locator(".records-card tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: "收支分析", exact: true }).click();
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.locator(".stats-grid")).toContainText("本周收入");
  await page.getByRole("button", { name: "年", exact: true }).click();
  await expect(page.locator(".stats-grid")).toContainText("本年收入");
  await page.getByRole("button", { name: "月", exact: true }).click();

  // Record mobile screenshot and ensure no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await dismissToasts(page);
  await page.screenshot({
    path: `${screenshotDir}/dashboard-mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1100 });

  const memberContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Shanghai",
  });
  const member = await memberContext.newPage();
  member.on("pageerror", (error) => errors.push(error.message));
  await register(member, memberPhone, "受邀家人");
  await page.getByRole("button", { name: "账本管理", exact: true }).click();
  const inviteForm = page
    .locator("form")
    .filter({ has: page.locator('input[type="tel"]') });
  await inviteForm.locator('input[type="tel"]').fill(memberPhone);
  await inviteForm.getByRole("button", { name: /邀请/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "邀请已发送" }),
  ).toBeVisible();

  await member.getByRole("button", { name: /^我的邀请/ }).click();
  await member.getByRole("button", { name: "接受邀请", exact: true }).click();
  await expect(
    member.getByRole("heading", { name: "生活有数，心里有底" }),
  ).toBeVisible();
  await expect(member.locator(".records-card tbody tr")).toHaveCount(2);
  // A family member may see but not edit/delete another person's records.
  await expect(member.locator(".records-card tbody button")).toHaveCount(0);
  await record(member, {
    amount: "12.00",
    category: "交通出行",
    note: "家人的地铁出行",
  });

  await createBook(page, "我的私人日常");
  await page.reload();
  await expect(page.getByLabel("当前账本")).toContainText("我的私人日常");
  await member.reload();
  await expect(member.getByLabel("当前账本")).not.toContainText("我的私人日常");
  await page.getByRole("button", { name: /小家体验用户.*账户与安全/ }).click();
  const passwordForm = page
    .locator(".security-card")
    .filter({
      has: page.getByRole("heading", { name: "修改密码", exact: true }),
    });
  await passwordForm
    .getByLabel("当前密码", { exact: true })
    .fill("Wrong-Password-2026!");
  await passwordForm
    .getByLabel("新密码", { exact: true })
    .fill("Updated-Browser-2026!");
  await passwordForm
    .getByRole("button", { name: "更新密码", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "当前密码不正确" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "账户与安全", exact: true }),
  ).toBeVisible();
  await passwordForm.getByLabel("当前密码", { exact: true }).fill(password);
  await passwordForm
    .getByRole("button", { name: "更新密码", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "密码已更新" }),
  ).toBeVisible();
  const phoneForm = page
    .locator(".security-card")
    .filter({
      has: page.getByRole("heading", { name: "更换手机号", exact: true }),
    });
  const account = await page.request.get('/api/auth/me');
  expect(account.ok()).toBeTruthy();
  const userId = (await account.json()).data.id;
  const replacement = phone();
  await phoneForm.getByLabel("新手机号", { exact: true }).fill(replacement);
  await phoneForm.getByLabel("短信验证码").fill(smsCode(replacement, 'phone_change', userId));
  await phoneForm
    .getByLabel("当前密码", { exact: true })
    .fill("Updated-Browser-2026!");
  await phoneForm
    .getByRole("button", { name: "更换手机号", exact: true })
    .click();
  await expect(page.locator(".account-profile")).toContainText(replacement);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "退出登录", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到小家" }),
  ).toBeVisible();
  await page.getByLabel("手机号", { exact: true }).fill(replacement);
  await page.getByLabel("密码", { exact: true }).fill("Updated-Browser-2026!");
  await page.getByRole("button", { name: "登录小家", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "生活有数，心里有底" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await memberContext.close();
});
