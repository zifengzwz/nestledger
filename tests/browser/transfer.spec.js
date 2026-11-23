import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";

async function downloaded(page, modal, label) {
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: label, exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return {
    filename: download.suggestedFilename(),
    buffer: Buffer.concat(chunks),
    text: Buffer.concat(chunks).toString("utf8"),
  };
}

async function recordPage(page, id) {
  const response = await page.request.get(
    `/api/books/${id}/records?pageSize=100`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function chooseBook(page, book) {
  await page
    .getByRole("listbox", { name: "当前账本", exact: true })
    .getByTitle(`${book.name} · ${book.type === "family" ? "家庭" : "个人"}`, {
      exact: true,
    })
    .click();
  await expect(page.locator(".page-heading p")).toContainText(book.name);
}

async function previewAndImport(page, target, file, expectedCount, headers) {
  await page.getByRole("button", { name: "导入账本", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "导入账本", exact: true });
  await modal.getByLabel("选择导入文件", { exact: true }).setInputFiles(file);
  await expect(modal.locator(".transfer-summary")).toContainText(
    `共 ${expectedCount} 笔`,
  );
  await expect(
    modal.getByRole("button", { name: "确认导入", exact: true }),
  ).toBeDisabled();
  expect((await recordPage(page, target.id)).total).toBe(0);
  const validation = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/books/${target.id}/import`) &&
      response.request().postDataJSON().dryRun === true,
  );
  await modal.getByRole("button", { name: "校验并预览", exact: true }).click();
  expect((await validation).status()).toBe(200);
  await expect(
    modal.getByRole("status").filter({ hasText: "服务器校验通过" }),
  ).toBeVisible();
  expect((await recordPage(page, target.id)).total).toBe(0);
  const commit = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/books/${target.id}/import`) &&
      response.request().postDataJSON().dryRun === false,
  );
  await modal.getByRole("button", { name: "确认导入", exact: true }).click();
  const response = await commit;
  expect(response.status()).toBe(201);
  const receipt = (await response.json()).data;
  expect(receipt.importedCount).toBe(expectedCount);
  await expect(
    modal.getByRole("status").filter({ hasText: "导入完成" }),
  ).toBeVisible();
  const body = response.request().postDataJSON();
  await expect(modal.locator(".transfer-request-id code")).toHaveText(
    body.requestId,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const replay = await page.request.post(`/api/books/${target.id}/import`, {
    headers,
    data: body,
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data.replayed).toBe(true);
  expect((await recordPage(page, target.id)).total).toBe(expectedCount);
  await modal.getByRole("button", { name: "完成", exact: true }).click();
  return body;
}

test("账本真实CSV/JSON下载、模板、校验预览和防重导入（含手机）", async ({
  page,
}) => {
  await page.goto("/");
  const headers = { Origin: new URL(page.url()).origin };
  const registration = await registerWithSms(page.request, {
    headers,
    data: {
      phone: `186${String(randomInt(100000000)).padStart(8, "0")}`,
      password: "Transfer-Test-2026!",
      name: "导入导出测试",
    },
  });
  expect(registration.status()).toBe(201);
  const user = (await registration.json()).data;
  const books = [];
  try {
    for (const [name, type] of [
      ["导出测试", "personal"],
      ["JSON目标", "personal"],
      ["CSV家庭目标", "family"],
      ["模板目标", "personal"],
    ]) {
      const response = await page.request.post("/api/books", {
        headers,
        data: { name, type },
      });
      expect(response.status()).toBe(201);
      books.push((await response.json()).data);
    }
    const [source, jsonTarget, csvTarget, templateTarget] = books;
    const records = [
      {
        type: "income",
        amountCents: 600000,
        category: "工资薪酬",
        subcategory: "基本工资",
        occurredAt: "2026-11-17T00:01:02.345Z",
        note: "工资到账",
        paymentSource: "银行卡",
      },
      {
        type: "expense",
        amountCents: 12345,
        category: "交通出行",
        subcategory: "地铁",
        occurredAt: "2026-11-17T01:22:33.456Z",
        note: '通勤,包含"引号"\n第二行',
        paymentSource: "银行卡",
      },
      {
        type: "expense",
        amountCents: 89,
        category: "购物消费",
        subcategory: "服饰",
        occurredAt: "2026-11-17T02:00:00.000Z",
        note: "=1+2",
        paymentSource: "支付宝",
      },
    ];
    for (const row of records) {
      const response = await page.request.post(
        `/api/books/${source.id}/records`,
        { headers, data: row },
      );
      expect(response.status()).toBe(201);
    }
    await page.reload();
    await chooseBook(page, source);
    await page.getByRole("button", { name: "导出账本", exact: true }).click();
    let modal = page.getByRole("dialog", { name: "导出账本", exact: true });
    await modal.getByLabel("导出开始日期").fill("2026-11-17");
    await modal.getByLabel("导出结束日期").fill("2026-11-17");
    const json = await downloaded(page, modal, "下载 JSON");
    expect(json.filename).toMatch(/\.json$/);
    const backup = JSON.parse(json.text);
    expect(backup.format).toBe("nestledger");
    expect(backup.version).toBe(1);
    expect(backup.book.name).toBe(source.name);
    expect(backup.records).toEqual(records);
    expect(json.text).not.toContain(user.phone);
    expect(json.text).not.toContain("createdBy");
    const csv = await downloaded(page, modal, "下载 CSV");
    expect(csv.buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.text).toContain("收支类型");
    expect(csv.text).toContain("小分类");
    expect(csv.text).toContain("基本工资");
    expect(csv.text).toContain("支付方式");
    expect(csv.text).toContain("123.45");
    expect(csv.text).toContain('包含""引号""');
    expect(csv.text).toContain("'=1+2");
    const template = await downloaded(page, modal, "下载 CSV 模板");
    expect(template.filename).toContain("模板");
    await modal.getByRole("button", { name: "取消", exact: true }).click();

    await chooseBook(page, jsonTarget);
    await page.getByRole("button", { name: "导入账本", exact: true }).click();
    modal = page.getByRole("dialog", { name: "导入账本", exact: true });
    const requests = [];
    const capture = (request) => {
      if (request.url().endsWith(`/api/books/${jsonTarget.id}/import`))
        requests.push(request);
    };
    page.on("request", capture);
    await modal
      .getByLabel("选择导入文件", { exact: true })
      .setInputFiles({
        name: "损坏.json",
        mimeType: "application/json",
        buffer: Buffer.from("{broken"),
      });
    await expect(modal.getByRole("alert")).toBeVisible();
    expect((await recordPage(page, jsonTarget.id)).total).toBe(0);
    expect(requests).toHaveLength(0);
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    const importBody = await previewAndImport(
      page,
      jsonTarget,
      {
        name: json.filename,
        mimeType: "application/json",
        buffer: json.buffer,
      },
      3,
      headers,
    );
    page.off("request", capture);
    const imported = await recordPage(page, jsonTarget.id);
    expect(imported.items.every((row) => row.createdBy === user.id)).toBe(true);
    const exportedAgain = await page.request.get(
      `/api/books/${jsonTarget.id}/export`,
    );
    expect((await exportedAgain.json()).data.records).toEqual(records);
    await expect(page.locator(".stats-grid")).toContainText("6,000.00");
    await expect(page.locator(".stats-grid")).toContainText("124.34");
    const conflict = await page.request.post(
      `/api/books/${jsonTarget.id}/import`,
      { headers, data: { ...importBody, records: [records[0]] } },
    );
    expect(conflict.status()).toBe(409);
    expect((await recordPage(page, jsonTarget.id)).total).toBe(3);

    await chooseBook(page, csvTarget);
    await previewAndImport(
      page,
      csvTarget,
      { name: csv.filename, mimeType: "text/csv", buffer: csv.buffer },
      3,
      headers,
    );
    const csvExport = await page.request.get(
      `/api/books/${csvTarget.id}/export`,
    );
    expect((await csvExport.json()).data.records).toEqual(records);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await chooseBook(page, templateTarget);
    await page.getByRole("button", { name: "关闭导航", exact: true }).click();
    await previewAndImport(
      page,
      templateTarget,
      {
        name: template.filename,
        mimeType: "text/csv",
        buffer: template.buffer,
      },
      1,
      headers,
    );
    expect(
      (await recordPage(page, templateTarget.id)).items[0].amountCents,
    ).toBe(1250);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    for (const book of books) {
      const deleted = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(deleted.status()).toBe(200);
    }
  }
});
