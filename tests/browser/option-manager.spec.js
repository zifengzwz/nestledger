import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
const phone = () => `185${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Option-Manager-2026!";

test("独立的分类与支付方式页面可增删大分类、小分类和支付方式", async ({
  page,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone: phone(), password, name: "选项管理验证" },
  });
  expect(registered.status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "分类与支付方式", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "分类与支付方式", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: /添加支出大分类/ }).click();
  let form = page.locator(".option-add-form");
  await form.getByLabel("名称").fill("宠物开销");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  const petCard = page
    .locator(".option-card")
    .filter({ hasText: "宠物开销" });
  await expect(petCard).toBeVisible();
  await expect(petCard).toContainText("自定义");

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
  await form.getByRole("button", { name: "保存", exact: true }).click();
  const paymentCard = page
    .locator(".option-card")
    .filter({ hasText: "交通卡" });
  await expect(paymentCard).toBeVisible();
  await expect(paymentCard).toContainText("自定义");

  await page
    .locator(".segmented")
    .getByRole("button", { name: "支出分类", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await petCard
    .getByRole("button", { name: "删除小分类宠物用品", exact: true })
    .click();
  await expect(dialog).toContainText("删除小分类");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(petCard.locator(".sub-chip")).toContainText("宠物用品");
  await petCard
    .getByRole("button", { name: "删除小分类宠物用品", exact: true })
    .click();
  await expect(dialog).toContainText("删除小分类");
  await dialog.getByRole("button", { name: "确定删除", exact: true }).click();
  await expect(petCard.locator(".sub-chip")).toHaveCount(0);

  await petCard.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toContainText("删除支出大分类");
  await dialog.getByRole("button", { name: "确定删除", exact: true }).click();
  await expect(
    page.locator(".option-card").filter({ hasText: "宠物开销" }),
  ).toHaveCount(0);

  await page
    .locator(".segmented")
    .getByRole("button", { name: "支付方式", exact: true })
    .click();
  await paymentCard.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toContainText("删除支付方式");
  await dialog.getByRole("button", { name: "确定删除", exact: true }).click();
  await expect(
    page.locator(".option-card").filter({ hasText: "交通卡" }),
  ).toHaveCount(0);
});