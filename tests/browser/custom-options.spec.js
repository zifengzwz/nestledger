import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
const screenshotDir = new URL("../../docs/screenshots/", import.meta.url)
  .pathname;

async function addOption(page, kind, name, touch = false) {
  const modal = page.getByRole("dialog");
  const label = kind === "paymentSource" ? "添加支付方式" : "添加分类";
  const button = modal.getByRole("button", { name: label, exact: true });
  if (touch) await button.tap();
  else await button.click();
  const input = modal.locator("#custom-option-name");
  await expect(input).toBeFocused();
  await input.fill(name);
  const selected =
    kind === "expenseCategory"
      ? { key: "paw-print", label: "宠物" }
      : kind === "incomeCategory"
        ? { key: "book-open", label: "书籍" }
        : name === "交通卡"
          ? { key: "credit-card", label: "银行卡" }
          : { key: "banknote", label: "现金" };
  const radio = modal.getByRole("radio", {
    name: `图标：${selected.label}`,
    exact: true,
  });
  if (touch) await radio.tap();
  else await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
  if (kind === "expenseCategory" && !touch) {
    await mkdir(screenshotDir, { recursive: true });
    await modal
      .locator(".icon-picker")
      .screenshot({
        path: `${screenshotDir}/icon-picker.png`,
        animations: "disabled",
      });
  }
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/record-options") &&
      response.request().method() === "POST",
  );
  const save = modal.getByRole("button", { name: "保存选项", exact: true });
  if (touch) await save.tap();
  else await save.click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({
    kind,
    name,
    icon: selected.key,
  });
  const data = (await response.json()).data;
  expect(data.icons[kind][name]).toBe(selected.key);
  await expect(
    modal.locator(`.select-current-icon[data-option-icon="${selected.key}"]`),
  ).toBeVisible();
  await expect(modal.locator(".custom-option-editor")).toHaveCount(0);
  await expect(
    modal.getByRole("combobox", {
      name: kind === "paymentSource" ? "支付方式" : "分类",
      exact: true,
    }),
  ).toHaveValue(name);
}

test("用户添加收支分类和支付方式，下拉可选择且跨设备持久化", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const phone = `185${String(randomInt(100000000)).padStart(8, "0")}`;
  const password = "Custom-Options-2026!";
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone, password, name: "自定义选项测试" },
  });
  expect(registered.status()).toBe(201);
  const response = await page.request.post("/api/books", {
    headers,
    data: { name: "自定义记账选项", type: "personal" },
  });
  expect(response.status()).toBe(201);
  const book = (await response.json()).data;
  try {
    await page.reload();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("金额（元）", { exact: true }).fill("68.50");
    await addOption(page, "expenseCategory", "宠物开销");
    await addOption(page, "paymentSource", "交通卡");
    await expect(modal.getByLabel("金额（元）", { exact: true })).toHaveValue(
      "68.50",
    );
    await modal
      .getByRole("button", { name: "添加支付方式", exact: true })
      .click();
    await modal.locator("#custom-option-name").fill("交通卡");
    await modal.getByRole("button", { name: "保存选项", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("该选项已存在");
    await expect(modal.locator(".custom-option-editor")).toHaveCount(1);
    await modal.getByRole("button", { name: "取消添加", exact: true }).click();
    await modal.getByRole("button", { name: "记好了", exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator(".records-card tbody")).toContainText("宠物开销");
    await expect(page.locator(".records-card tbody")).toContainText("交通卡");
    await expect(
      page.locator('.records-card .record-icon [data-option-icon="paw-print"]'),
    ).toBeVisible();
    await expect(
      page.locator(
        '.records-card .payment-tag [data-option-icon="credit-card"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator('.category-label [data-option-icon="paw-print"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    await modal.getByRole("button", { name: "收入", exact: true }).click();
    await addOption(page, "incomeCategory", "版税收入");
    await modal.getByRole("button", { name: "展开分类选项" }).click();
    await expect(
      modal.getByRole("option", { name: "宠物开销", exact: true }),
    ).toHaveCount(0);
    await modal
      .getByRole("combobox", { name: "分类", exact: true })
      .press("Escape");
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    await modal.getByRole("button", { name: "展开分类选项" }).click();
    await expect(
      modal
        .getByRole("option", { name: "宠物开销", exact: true })
        .locator('[data-option-icon="paw-print"]'),
    ).toBeVisible();
    await modal.getByRole("option", { name: "宠物开销", exact: true }).click();
    await expect(
      modal.getByRole("combobox", { name: "分类", exact: true }),
    ).toHaveValue("宠物开销");
    await modal.getByRole("button", { name: "取消", exact: true }).click();

    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      const mobile = await context.newPage();
      const login = await mobile.request.post("/api/auth/login", {
        headers,
        data: { phone, password },
      });
      expect(login.status()).toBe(200);
      await mobile.goto("/");
      await mobile.getByRole("button", { name: "记一笔", exact: true }).tap();
      const mobileModal = mobile.getByRole("dialog");
      await mobileModal.getByRole("button", { name: "展开支付方式选项" }).tap();
      await mobileModal
        .getByRole("option", { name: "交通卡", exact: true })
        .tap();
      await expect(
        mobileModal.getByRole("combobox", { name: "支付方式", exact: true }),
      ).toHaveValue("交通卡");
      await expect(
        mobileModal.locator(
          '.select-current-icon[data-option-icon="credit-card"]',
        ),
      ).toBeVisible();
      await addOption(mobile, "paymentSource", "家庭零钱", true);
      await mobileModal
        .getByRole("button", { name: "取消", exact: true })
        .tap();
    } finally {
      await context.close();
    }
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    await modal.getByRole("button", { name: "展开支付方式选项" }).click();
    await expect(
      modal.getByRole("option", { name: "家庭零钱", exact: true }),
    ).toBeVisible();
    await expect(
      modal
        .getByRole("option", { name: "家庭零钱", exact: true })
        .locator('[data-option-icon="banknote"]'),
    ).toBeVisible();
  } finally {
    const deleted = await page.request.delete(`/api/books/${book.id}`, {
      headers,
      data: {},
    });
    expect(deleted.status()).toBe(200);
  }
});
