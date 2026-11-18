import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import Modal from "../components/Modal.vue";
import TrendChart from "../components/TrendChart.vue";
import { nextTick } from "vue";
afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});
describe("accessible confirmation modal", () => {
  it("has accessible dialog name and closes on Escape", async () => {
    const wrapper = mount(Modal, {
      props: { title: "删除记录？" },
      attachTo: document.body,
      slots: { default: "<button autofocus>确认删除</button>" },
    });
    await nextTick();
    expect(wrapper.get('[role="dialog"]').attributes("aria-modal")).toBe(
      "true",
    );
    expect(wrapper.get("h2").text()).toBe("删除记录？");
    expect(document.activeElement?.textContent).toBe("确认删除");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
  it("prevents escape while saving", () => {
    const wrapper = mount(Modal, { props: { title: "保存", busy: true } });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it("wraps keyboard focus and returns focus on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(Modal, {
      props: { title: "测试" },
      attachTo: document.body,
      slots: {
        default: "<button autofocus>第一步</button><button>最后一步</button>",
      },
    });
    await nextTick();
    const buttons = wrapper.findAll("button");
    (buttons[buttons.length - 1].element as HTMLElement).focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[0].element);
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
  });
});
describe("SVG trend chart", () => {
  it("renders zero-value buckets without NaN or Infinity", () => {
    const wrapper = mount(TrendChart, {
      props: {
        points: [
          { label: "11-16", incomeCents: 0, expenseCents: 0 },
          { label: "11-17", incomeCents: 0, expenseCents: 0 },
        ],
      },
    });
    expect(wrapper.get("svg").attributes("aria-label")).toContain("趋势图");
    expect(wrapper.html()).not.toMatch(/NaN|Infinity/);
    expect(wrapper.findAll("polyline")).toHaveLength(2);
    expect(wrapper.text()).toContain("11-16");
  });
  it("provides precise textual values for each point", () => {
    const wrapper = mount(TrendChart, {
      props: {
        points: [{ label: "周一", incomeCents: 12345, expenseCents: 29 }],
      },
    });
    expect(wrapper.findAll("title").map((x) => x.text())).toEqual([
      "周一 收入 ¥123.45",
      "周一 支出 ¥0.29",
    ]);
  });
});
