import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import DataTransfer from "../components/DataTransfer.vue";
import type { Book } from "../api";
import { parseCSV, templateCSV } from "../dataTransfer";
const book: Book = {
  id: "b1",
  name: "当前账本",
  type: "family",
  ownerId: "u1",
  memberIds: ["u1"],
  createdAt: "2026-01-01T00:00:00Z",
};
let wrapper: VueWrapper | undefined;
const response = (data: unknown) => new Response(JSON.stringify({ data }));
function start(mode: "import" | "export" = "import") {
  const transport = vi.fn(async (_path: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body || "{}"));
    return response(
      body.dryRun
        ? { validated: true, count: body.records.length, dryRun: true }
        : {
            importedCount: body.records.length,
            replayed: false,
            requestId: body.requestId,
          },
    );
  });
  vi.stubGlobal("fetch", transport);
  wrapper = mount(DataTransfer, {
    props: { book, mode },
    attachTo: document.body,
  });
  return transport;
}
function button(label: string) {
  return wrapper!.findAll("button").find((node) => node.text() === label)!;
}
async function upload(text = templateCSV(), name = "模板.csv") {
  const input = wrapper!.get('[aria-label="选择导入文件"]');
  const file = new File([text], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
  await flushPromises();
}
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});
describe("manual safe append import", () => {
  it("previews locally with no API call; requires real dryRun before explicit confirmation", async () => {
    const transport = start();
    await upload();
    expect(wrapper!.text()).toContain("共 1 笔");
    expect(wrapper!.text()).toContain("支出 ¥12.50");
    expect(transport).not.toHaveBeenCalled();
    expect(button("确认导入").attributes("disabled")).toBeDefined();
    await button("校验并预览").trigger("click");
    await flushPromises();
    expect(button("确认导入").attributes("disabled")).toBeUndefined();
    expect(JSON.parse(String(transport.mock.calls[0]![1].body))).toMatchObject({
      dryRun: true,
      records: [{ amountCents: 1250 }],
    });
    await button("确认导入").trigger("click");
    await flushPromises();
    const bodies = transport.mock.calls.map((call) =>
      JSON.parse(String(call[1].body)),
    );
    expect(bodies[1].requestId).toBe(bodies[0].requestId);
    expect(bodies[1].dryRun).toBe(false);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      "/api/books/b1/import",
      "/api/books/b1/import",
    ]);
    expect(wrapper!.emitted("imported")).toEqual([["b1", 1]]);
    expect(button("确认导入").attributes("disabled")).toBeDefined();
  });
  it("prevents duplicate commits and preserves requestId on ambiguous network retry", async () => {
    const transport = start();
    await upload();
    await button("校验并预览").trigger("click");
    await flushPromises();
    let reject!: (error: Error) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await button("确认导入").trigger("click");
    await button("确认导入").trigger("click");
    expect(transport).toHaveBeenCalledTimes(2);
    reject(new Error("offline"));
    await flushPromises();
    expect(wrapper!.text()).toContain("网络连接失败");
    await button("确认导入").trigger("click");
    await flushPromises();
    const bodies = transport.mock.calls.map((call) =>
      JSON.parse(String(call[1].body)),
    );
    expect(bodies[2].requestId).toBe(bodies[1].requestId);
    expect(wrapper!.emitted("imported")).toHaveLength(1);
  });
  it("regenerates tokens for different files and discards validation on target switch", async () => {
    const transport = start();
    await upload();
    await button("校验并预览").trigger("click");
    await flushPromises();
    const token = JSON.parse(
      String(transport.mock.calls[0]![1].body),
    ).requestId;
    await upload(templateCSV(), "第二个.csv");
    expect(button("确认导入").attributes("disabled")).toBeDefined();
    await button("校验并预览").trigger("click");
    await flushPromises();
    expect(
      JSON.parse(String(transport.mock.calls[1]![1].body)).requestId,
    ).not.toBe(token);
    await wrapper!.setProps({ book: { ...book, id: "b2", name: "新目标" } });
    expect(wrapper!.text()).toContain("目标账本已切换");
    expect(wrapper!.text()).not.toContain("共 1 笔");
    expect(
      wrapper!.findAll("button").some((node) => node.text() === "确认导入"),
    ).toBe(false);
  });
  it("ignores a dryRun result for a stale target and never confirms the wrong book", async () => {
    const transport = start();
    await upload();
    let resolve!: (value: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await button("校验并预览").trigger("click");
    await wrapper!.setProps({ book: { ...book, id: "b2" } });
    resolve(response({ validated: true, count: 1, dryRun: true }));
    await flushPromises();
    expect(wrapper!.text()).not.toContain("服务器校验通过");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed files before the API and never renders file names as HTML", async () => {
    const transport = start();
    await upload("invalid", "<img src=x onerror=alert(1)>.csv");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper!.text()).toContain("<img src=x onerror=alert(1)>.csv");
    expect(wrapper!.find("img").exists()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it("forwards unauthorized errors to the App and keeps confirmation disabled", async () => {
    const transport = start();
    await upload();
    transport.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "请登录" } }),
        { status: 401 },
      ),
    );
    await button("校验并预览").trigger("click");
    await flushPromises();
    expect(wrapper!.emitted("failure")?.[0]?.[0]).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(button("确认导入").attributes("disabled")).toBeDefined();
  });
  it("does not allow commit when dryRun returns an invalid response", async () => {
    const transport = start();
    await upload();
    transport.mockResolvedValueOnce(
      response({ validated: true, count: 9, dryRun: true }),
    );
    await button("校验并预览").trigger("click");
    await flushPromises();
    expect(button("确认导入").attributes("disabled")).toBeDefined();
    expect(wrapper!.text()).toContain("校验结果异常");
  });
});
describe("real export downloads", () => {
  it.each(["CSV", "JSON"])(
    "downloads %s from the export endpoint using Shanghai dates",
    async (format) => {
      const transport = start("export");
      const records = parseCSV(templateCSV()).records;
      const backup = {
        format: "nestledger",
        version: 1,
        exportedAt: "2026-11-17T00:00:00.000Z",
        book: { name: book.name, type: book.type },
        records,
      };
      transport.mockResolvedValueOnce(response(backup));
      const create = vi.fn((_blob: Blob) => "blob:export");
      vi.stubGlobal("URL", {
        createObjectURL: create,
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => {},
      );
      await wrapper!.get('[aria-label="导出开始日期"]').setValue("2026-11-01");
      await wrapper!.get('[aria-label="导出结束日期"]').setValue("2026-11-17");
      await button(`下载 ${format}`).trigger("click");
      await flushPromises();
      const url = transport.mock.calls[0]![0];
      expect(url).toContain("/api/books/b1/export?");
      const query = new URLSearchParams(url.split("?")[1]);
      expect(query.get("from")).toBe("2026-10-31T16:00:00.000Z");
      expect(query.get("to")).toBe("2026-11-17T16:00:00.000Z");
      expect(create).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0]![0] as Blob;
      expect(blob.type).toContain(
        format === "CSV" ? "text/csv" : "application/json",
      );
      expect(wrapper!.emitted("downloaded")).toHaveLength(1);
    },
  );
  it("shows server export-limit errors without fake downloads", async () => {
    const transport = start("export");
    transport.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "EXPORT_LIMIT_EXCEEDED",
            message: "超过5000笔，请缩小日期范围",
          },
        }),
        { status: 422 },
      ),
    );
    const create = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    await button("下载 JSON").trigger("click");
    await flushPromises();
    expect(wrapper!.text()).toContain("缩小日期范围");
    expect(create).not.toHaveBeenCalled();
    expect(wrapper!.emitted("downloaded")).toBeUndefined();
  });
});
