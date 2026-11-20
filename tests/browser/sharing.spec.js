import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
const phone = () => `183${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Book-Sharing-2026!";

async function createBook(page, name) {
  await page
    .getByRole("button", { name: "新建账本", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("账本名称").fill(name);
  await modal.getByLabel("个人账本").check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/books") &&
      response.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "创建账本", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const book = (await response.json()).data;
  await expect(modal).toBeHidden();
  return book;
}

test("拥有者按手机号分享账本，指定用户可接受或拒绝只读查看", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const ownerPhone = phone(),
    viewerPhone = phone();
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone: ownerPhone, password, name: "分享账本拥有者" },
  });
  expect(registered.status()).toBe(201);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "生活有数，心里有底" }),
  ).toBeVisible();
  const book = await createBook(page, "只读分享验证账本");
  const recordResponse = await page.request.post(
    `/api/books/${book.id}/records`,
    {
      headers,
      data: {
        type: "expense",
        amountCents: 2880,
        category: "分享午餐",
        occurredAt: "2026-11-19T04:30:00.000Z",
        note: "只读可见的备注",
        paymentSource: "微信",
      },
    },
  );
  expect(recordResponse.status()).toBe(201);

  const viewerContext = await browser.newContext({ baseURL: origin });
  try {
    const viewer = await viewerContext.newPage();
    const viewerRegistered = await registerWithSms(viewer.request, {
      headers,
      data: { phone: viewerPhone, password, name: "被分享的家人" },
    });
    expect(viewerRegistered.status()).toBe(201);

    await page.getByRole("button", { name: "分享账本", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("对方手机号").fill(viewerPhone);
    const sharePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/books/${book.id}/shares`) &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "分享", exact: true }).click();
    expect((await sharePromise).status()).toBe(201);
    await expect(
      dialog.getByText("分享邀请已发送给 被分享的家人"),
    ).toBeVisible();
    await expect(dialog.locator(".share-row")).toHaveCount(1);
    await expect(dialog.locator(".share-row")).toContainText("被分享的家人");
    await expect(dialog.locator(".share-row")).toContainText("待接受");

    await viewer.goto("/");
    await expect(
      viewer.getByRole("button", { name: /我的邀请/ }),
    ).toBeVisible();
    await viewer.getByRole("button", { name: /我的邀请/ }).click();
    await expect(viewer.getByText("分享给我的账本")).toBeVisible();
    await expect(viewer.getByText("只读分享验证账本")).toBeVisible();
    await expect(viewer.locator(".invitation-card")).toContainText(ownerPhone);
    const acceptPromise = viewer.waitForResponse(
      (response) =>
        response.url().includes("/api/shares/") &&
        response.url().endsWith("/accept") &&
        response.request().method() === "POST",
    );
    await viewer.getByRole("button", { name: "接受分享", exact: true }).click();
    expect((await acceptPromise).status()).toBe(200);
    await expect(
      viewer.getByRole("heading", { name: "生活有数，心里有底" }),
    ).toBeVisible();
    await expect(viewer.locator(".book-kind")).toHaveText("只读");
    await expect(viewer.locator(".book-owner")).toContainText(ownerPhone);
    await expect(viewer.locator(".invitation-info")).toContainText(ownerPhone);
    await expect(viewer.locator(".invitation-info")).toContainText(
      "分享账本拥有者",
    );
    await expect(viewer.locator(".invitation-info")).toContainText(
      "分享给你的只读账本",
    );
    await expect(
      viewer.getByRole("button", { name: "记一笔", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "导出账本", exact: true }),
    ).toHaveCount(0);
    await viewer.getByRole("button", { name: "收支明细", exact: true }).click();
    await expect(viewer.getByText("分享午餐")).toBeVisible();
    await expect(viewer.getByText("只读可见的备注")).toBeVisible();
    await expect(viewer.getByText("仅可查看")).toBeVisible();
    await viewer.getByRole("button", { name: "账本管理", exact: true }).click();
    await expect(viewer.getByText("只读访客", { exact: true })).toBeVisible();
    const denied = await viewer.request.post(
      `/api/books/${book.id}/records`,
      {
        headers,
        data: {
          type: "expense",
          amountCents: 100,
          category: "越权尝试",
          occurredAt: "2026-11-19T04:30:00.000Z",
          note: "",
          paymentSource: "微信",
        },
      },
    );
    expect(denied.status()).toBe(403);

    await page.getByRole("button", { name: "取消分享", exact: true }).click();
    const revokePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/books/${book.id}/shares/`) &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "确定取消", exact: true }).click();
    expect((await revokePromise).status()).toBe(200);
    await viewer.reload();
    await expect(viewer.locator(".book-kind")).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "创建我的第一本账本" }),
    ).toBeVisible();

    // Send the invitation again, this time the recipient rejects it.
    await dialog.getByLabel("对方手机号").fill(viewerPhone);
    const resharePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/books/${book.id}/shares`) &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "分享", exact: true }).click();
    expect((await resharePromise).status()).toBe(201);
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await viewer.reload();
    await viewer.getByRole("button", { name: /我的邀请/ }).click();
    await expect(viewer.getByText("分享给我的账本")).toBeVisible();
    await viewer.getByRole("button", { name: "拒绝", exact: true }).click();
    const rejectPromise = viewer.waitForResponse(
      (response) =>
        response.url().includes("/api/shares/") &&
        response.url().endsWith("/reject") &&
        response.request().method() === "POST",
    );
    await viewer
      .getByRole("button", { name: "拒绝分享", exact: true })
      .click();
    expect((await rejectPromise).status()).toBe(200);
    await expect(viewer.getByText("暂时没有新邀请")).toBeVisible();
    await viewer.reload();
    await expect(viewer.locator(".book-kind")).toHaveCount(0);

    await page.getByRole("button", { name: "分享账本", exact: true }).click();
    await expect(page.locator(".share-row")).toContainText("已拒绝");
    await expect(
      page.getByRole("button", { name: "重新分享", exact: true }),
    ).toBeVisible();
  } finally {
    await viewerContext.close();
    const deleted = await page.request.delete(`/api/books/${book.id}`, {
      headers,
      data: {},
    });
    expect(deleted.status()).toBe(200);
  }
});