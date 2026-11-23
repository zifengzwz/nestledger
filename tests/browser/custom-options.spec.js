import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
const screenshotDir = new URL("../../docs/screenshots/", import.meta.url)
  .pathname;
const phone = () => `185${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Custom-Options-2026!";

test("用户在大分类管理页添加选项，记账下拉可选择且跨设备持久化", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const ownerPhone = phone();
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone: ownerPhone, password, name: "自定义选项测试" },
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
    await page
      .getByRole("button", { name: "分类与支付方式", exact: true })
      .click();

    await page.getByRole("button", { name: /添加支出大分类/ }).click();
    let form = page.locator(".option-add-form");
    await form.getByLabel("名称").fill("宠物开销");
    await form.getByRole("radio", { name: "图标：宠物", exact: true }).click();
    await mkdir(screenshotDir, { recursive: true });
    await form.locator(".icon-picker").screenshot({
      path: `${screenshotDir}/icon-picker.png`,
      animations: "disabled",
    });
    await form.getByRole("button", { name: "保存", exact: true }).click();
    const petCard = page
      .locator(".option-card")
      .filter({ hasText: "宠物开销" });
    await expect(petCard).toBeVisible();
    await petCard.getByRole("button", { name: /小分类/ }).click();
    const subForm = petCard.locator(".option-sub-form");
    await subForm.getByLabel("为宠物开销添加小分类").fill("宠物用品");
    await subForm.getByRole("button", { name: "添加", exact: true }).click();
    await expect(petCard.locator(".sub-chip")).toContainText("宠物用品");

    await page
      .locator(".segmented")
      .getByRole("button", { name: "支付方式", exact: true })
      .click();
    await page.getByRole("button", { name: /添加支付方式/ }).click();
    form = page.locator(".option-add-form");
    await form.getByLabel("名称").fill("交通卡");
    await form.getByRole("radio", { name: "图标：银行卡", exact: true }).click();
    await form.getByRole("button", { name: "保存", exact: true }).click();

    await page
      .locator(".segmented")
      .getByRole("button", { name: "收入分类", exact: true })
      .click();
    await page.getByRole("button", { name: /添加收入大分类/ }).click();
    form = page.locator(".option-add-form");
    await form.getByLabel("名称").fill("版税收入");
    await form.getByRole("radio", { name: "图标：书籍", exact: true }).click();
    await form.getByRole("button", { name: "保存", exact: true }).click();

    await page.getByRole("button", { name: "账本概览", exact: true }).click();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal.getByLabel("金额（元）", { exact: true }).fill("68.50");
    const category = modal.getByRole("combobox", {
      name: "大分类",
      exact: true,
    });
    await category.fill("宠物开销");
    await modal
      .getByRole("option", { name: "宠物开销", exact: true })
      .click();
    await expect(
      modal.getByRole("combobox", { name: "小分类", exact: true }),
    ).toHaveValue("宠物用品");
    const payment = modal.getByRole("combobox", {
      name: "支付方式",
      exact: true,
    });
    await payment.fill("交通卡");
    await modal.getByRole("option", { name: "交通卡", exact: true }).click();
    await modal.getByRole("button", { name: "记好了", exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator(".records-card tbody")).toContainText("宠物开销");
    await expect(page.locator(".records-card tbody")).toContainText("宠物用品");
    await expect(page.locator(".records-card tbody")).toContainText("交通卡");
    await expect(
      page.locator('.records-card .record-icon [data-option-icon="paw-print"]'),
    ).toBeVisible();
    await expect(
      page.locator(
        '.records-card .payment-tag [data-option-icon="credit-card"]',
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "收入", exact: true }).click();
    await modal.getByRole("button", { name: "展开大分类选项" }).click();
    await expect(
      modal.getByRole("option", { name: "宠物开销", exact: true }),
    ).toHaveCount(0);
    await modal
      .getByRole("combobox", { name: "大分类", exact: true })
      .press("Escape");
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "展开大分类选项" }).click();
    await expect(
      modal
        .getByRole("option", { name: "宠物开销", exact: true })
        .locator('[data-option-icon="paw-print"]'),
    ).toBeVisible();
    await modal.getByRole("option", { name: "宠物开销", exact: true }).click();
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
        data: { phone: ownerPhone, password },
      });
      expect(login.status()).toBe(200);
      await mobile.goto("/");
      await mobile.getByRole("button", { name: "记一笔", exact: true }).tap();
      const mobileModal = mobile.getByRole("dialog");
      await mobileModal.getByRole("button", { name: "展开支付方式选项" }).tap();
      await expect(
        mobileModal
          .getByRole("option", { name: "交通卡", exact: true })
          .locator('[data-option-icon="credit-card"]'),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    const deleted = await page.request.delete(`/api/books/${book.id}`, {
      headers,
      data: {},
    });
    expect(deleted.status()).toBe(200);
  }
});
