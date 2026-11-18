import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
const phone = () => `182${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Invitation-Permissions-2026!";

async function createBook(page, type, name) {
  await page
    .getByRole("button", { name: "新建账本", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("账本名称").fill(name);
  await modal.getByLabel(type === "family" ? "家庭账本" : "个人账本").check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/books") &&
      response.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "创建账本", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const book = (await response.json()).data;
  expect(book.type).toBe(type);
  await expect(modal).toBeHidden();
  return book;
}

test("个人不可发送邀请、家庭拥有者可邀请、家庭成员有明确权限说明", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const ownerPhone = phone(),
    memberPhone = phone();
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone: ownerPhone, password, name: "邀请权限拥有者" },
  });
  expect(registered.status()).toBe(201);
  const owner = (await registered.json()).data;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "生活有数，心里有底" }),
  ).toBeVisible();
  const personal = await createBook(page, "personal", "私人账本权限验证");
  expect(personal.ownerId).toBe(owner.id);
  await expect(
    page.getByRole("button", { name: "邀请家人", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "账本管理", exact: true }).click();
  await expect(page.locator(".invite-form")).toHaveCount(0);
  await expect(
    page.getByText("个人账本仅本人可见，可以更名或删除，不支持邀请成员。", {
      exact: true,
    }),
  ).toBeVisible();
  const forbidden = await page.request.post(
    `/api/books/${personal.id}/invitations`,
    { headers, data: { phone: memberPhone } },
  );
  expect(forbidden.status()).toBe(409);
  await page.getByRole("button", { name: "我的邀请", exact: true }).click();
  await expect(page.locator(".invitation-info")).toContainText(
    "与左侧选择的账本无关",
  );

  const family = await createBook(page, "family", "家庭账本权限验证");
  expect(family.ownerId).toBe(owner.id);
  await page.getByRole("button", { name: "账本概览", exact: true }).click();
  await page.getByRole("button", { name: "邀请家人", exact: true }).click();
  await expect(page.getByLabel("邀请家人手机号")).toBeFocused();
  await page.getByLabel("邀请家人手机号").fill(memberPhone);
  const rejectedPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/books/${family.id}/invitations`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送邀请", exact: true }).click();
  const rejected = await rejectedPromise;
  expect(rejected.status()).toBe(404);
  expect((await rejected.json()).error.code).toBe("USER_NOT_REGISTERED");
  await expect(page.getByRole("alert")).toContainText(
    "该手机号尚未注册，请对方先注册后再邀请",
  );
  await expect(page.getByLabel("邀请家人手机号")).toHaveValue(memberPhone);

  const context = await browser.newContext({ baseURL: origin });
  try {
    const member = await context.newPage();
    const registration = await registerWithSms(member.request, {
      headers,
      data: { phone: memberPhone, password, name: "邀请权限家庭成员" },
    });
    expect(registration.status()).toBe(201);
    expect(
      (await (await member.request.get("/api/invitations")).json()).data,
    ).toEqual([]);
    await page.getByRole("button", { name: "发送邀请", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "邀请已发送" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const invites = (
      await (await member.request.get("/api/invitations")).json()
    ).data;
    const invite = invites.find((item) => item.bookId === family.id);
    expect(invite).toBeTruthy();
    const accepted = await member.request.post(
      `/api/invitations/${invite.id}/accept`,
      { headers, data: {} },
    );
    expect(accepted.status()).toBe(200);
    await member.goto("/");
    await expect(
      member.getByRole("heading", { name: "生活有数，心里有底" }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "邀请家人", exact: true }),
    ).toHaveCount(0);
    await member.getByRole("button", { name: "账本管理", exact: true }).click();
    await expect(member.locator(".invite-form")).toHaveCount(0);
    await expect(
      member.getByText(
        "只有家庭账本拥有者可以邀请新成员。你当前是家庭成员，请联系拥有者发送邀请。",
        { exact: true },
      ),
    ).toBeVisible();
    const denied = await member.request.post(
      `/api/books/${family.id}/invitations`,
      { headers, data: { phone: phone() } },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await context.close();
    for (const book of [personal, family]) {
      const deleted = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(deleted.status()).toBe(200);
    }
  }
});
