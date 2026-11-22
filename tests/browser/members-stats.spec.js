import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
const phone = () => `186${String(randomInt(100000000)).padStart(8, "0")}`;
const password = "Member-Stats-2026!";

test("家庭账本显示记录人，概览、明细和分析可按成员筛选统计", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const ownerPhone = phone(),
    memberPhone = phone();
  const ownerRegistered = await registerWithSms(page.request, {
    headers,
    data: { phone: ownerPhone, password, name: "成员统计拥有者" },
  });
  expect(ownerRegistered.status()).toBe(201);
  const owner = (await ownerRegistered.json()).data;

  let book;
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const memberPage = await memberContext.newPage();
    const memberRegistered = await registerWithSms(memberPage.request, {
      headers,
      data: { phone: memberPhone, password, name: "成员统计家人" },
    });
    expect(memberRegistered.status()).toBe(201);
    const member = (await memberRegistered.json()).data;

    const bookResponse = await page.request.post("/api/books", {
      headers,
      data: { name: "成员统计验证账本", type: "family" },
    });
    expect(bookResponse.status()).toBe(201);
    book = (await bookResponse.json()).data;
    const inviteResponse = await page.request.post(
      `/api/books/${book.id}/invitations`,
      { headers, data: { phone: memberPhone } },
    );
    expect(inviteResponse.status()).toBe(201);
    const invite = (await inviteResponse.json()).data;
    const acceptResponse = await memberPage.request.post(
      `/api/invitations/${invite.id}/accept`,
      { headers, data: {} },
    );
    expect(acceptResponse.status()).toBe(200);

    const payload = (category, note, occurredAt) => ({
      type: "expense",
      amountCents: 1234,
      category,
      occurredAt,
      note,
      paymentSource: "微信",
    });
    const ownerRecord = await page.request.post(
      `/api/books/${book.id}/records`,
      {
        headers,
        data: payload("早餐", "拥有者的早餐", "2026-11-22T01:00:00.000Z"),
      },
    );
    expect(ownerRecord.status()).toBe(201);
    const memberRecord = await memberPage.request.post(
      `/api/books/${book.id}/records`,
      {
        headers,
        data: payload("午餐", "家人的午餐", "2026-11-22T04:00:00.000Z"),
      },
    );
    expect(memberRecord.status()).toBe(201);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "生活有数，心里有底" }),
    ).toBeVisible();
    await expect(page.getByText("记录人", { exact: true })).toBeVisible();
    await expect(page.getByText("拥有者的早餐")).toBeVisible();
    await expect(page.getByText("家人的午餐")).toBeVisible();

    const memberFilter = page.getByLabel("按记录人筛选");
    await expect(
      memberFilter.locator(`option[value="${owner.id}"]`),
    ).toHaveText("我");
    await memberFilter.selectOption(member.id);
    await expect(memberFilter).toHaveValue(member.id);
    await expect(page.getByText("家人的午餐")).toBeVisible();
    await expect(page.getByText("拥有者的早餐")).toHaveCount(0);

    await page.getByRole("button", { name: "收支明细", exact: true }).click();
    await expect(page.getByText("家人的午餐")).toBeVisible();
    await expect(page.getByText("拥有者的早餐")).toHaveCount(0);

    await page.getByRole("button", { name: "收支分析", exact: true }).click();
    await expect(page.getByText("成员收支", { exact: true })).toBeVisible();
    const memberTable = page.locator(".member-table");
    await expect(memberTable).toContainText("我");
    await expect(memberTable).toContainText("成员统计家人");
    const ownerRow = memberTable
      .locator("tbody tr")
      .filter({ hasText: "我" });
    await ownerRow.getByRole("button", { name: "只看该成员" }).click();
    await expect(memberFilter).toHaveValue(owner.id);
    await expect(memberFilter.locator("option:checked")).toHaveText("我");

    await page.getByRole("button", { name: "全部账本", exact: true }).click();
    await expect(page.getByText("各账本汇总", { exact: true })).toBeVisible();
    const summaryTable = page.locator(".book-summary-table");
    await expect(summaryTable).toContainText("成员统计验证账本");
    await expect(
      summaryTable.locator("tbody tr").filter({ hasText: "成员统计验证账本" }),
    ).toContainText("1 笔");
    await expect(page.locator('select[aria-label="按记录人筛选"]')).toHaveCount(0);
    await page.getByRole("button", { name: "当前账本", exact: true }).click();
    await expect(memberFilter).toBeVisible();
    await expect(page.getByText("成员收支", { exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
    if (book) {
      const deleted = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(deleted.status()).toBe(200);
    }
  }
});