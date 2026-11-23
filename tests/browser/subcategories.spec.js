import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
const phone = () => `188${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Subcategory-2026!";

test("大分类下可选择和自定义小分类，并在明细筛选和分析中展示", async ({
  page,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone: phone(), password, name: "小分类验证用户" },
  });
  expect(registered.status()).toBe(201);
  let book;
  try {
    const bookResponse = await page.request.post("/api/books", {
      headers,
      data: { name: "小分类验证账本", type: "personal" },
    });
    expect(bookResponse.status()).toBe(201);
    book = (await bookResponse.json()).data;
    const subcategoryResponse = await page.request.post("/api/record-options", {
      headers,
      data: {
        kind: "expenseSubcategory",
        parent: "餐饮美食",
        name: "下午茶",
      },
    });
    expect(subcategoryResponse.status()).toBe(201);
    await page.reload();

    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal
      .getByRole("combobox", { name: "小分类", exact: true })
      .fill("早餐");
    await modal.getByLabel("金额（元）").fill("12.00");
    await modal.getByRole("button", { name: "记好了", exact: true }).click();
    await expect(modal).toBeHidden();
    await page.getByRole("button", { name: "收支明细", exact: true }).click();
    await expect(page.locator(".records-table")).toContainText("早餐");

    await page.getByRole("button", { name: "记一笔", exact: true }).click();
    modal = page.getByRole("dialog");
    const subcategory = modal.getByRole("combobox", {
      name: "小分类",
      exact: true,
    });
    await subcategory.fill("下午茶");
    await modal
      .getByRole("option", { name: "下午茶", exact: true })
      .click();
    await expect(subcategory).toHaveValue("下午茶");
    await modal.getByLabel("金额（元）").fill("8.00");
    await modal.getByRole("button", { name: "记好了", exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator(".records-table")).toContainText("下午茶");

    const filter = page.locator(".filter-form");
    await filter
      .getByRole("combobox", { name: "小分类", exact: true })
      .fill("下午茶");
    await filter.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.locator(".records-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".records-table")).toContainText("下午茶");

    await page.getByRole("button", { name: "收支分析", exact: true }).click();
    await expect(page.locator(".subcategory-list")).toContainText("下午茶");
    await expect(page.locator(".subcategory-list")).toContainText("早餐");
  } finally {
    if (book) {
      const deleted = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(deleted.status()).toBe(200);
    }
  }
});