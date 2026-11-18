import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import SelectInput from "../components/SelectInput.vue";

let wrapper: ReturnType<typeof mount> | undefined;
const options = ["微信", "支付宝", "银行卡", "现金", "其他"];
function setup() {
  wrapper = mount(SelectInput, {
    props: { label: "支付方式", modelValue: "微信", options },
    attachTo: document.body,
  });
  return wrapper;
}
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

describe("editable dropdown", () => {
  it("explicitly opens every option even when a default value is present", async () => {
    const field = setup();
    await field.get("button").trigger("click");
    expect(field.findAll('[role="option"]')).toHaveLength(5);
    expect(field.get("input").attributes("aria-expanded")).toBe("true");
    await field.findAll('[role="option"]')[2].trigger("click");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["银行卡"]);
    expect(field.find('[role="listbox"]').exists()).toBe(false);
  });
  it("allows filtering and custom input instead of enforcing built-in choices", async () => {
    const field = setup();
    await field.get("input").setValue("支付");
    expect(
      field.findAll('[role="option"]').map((option) => option.text()),
    ).toEqual(["支付宝"]);
    await field.get("input").setValue("家庭备用金");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["家庭备用金"]);
    expect(field.text()).toContain("可直接输入");
    // Reopening always clears the search without erasing the entered value.
    await field.get("input").trigger("keydown", { key: "Escape" });
    await field.get("button").trigger("click");
    expect(field.findAll('[role="option"]')).toHaveLength(5);
  });
  it("supports arrows and Enter without submitting the surrounding form", async () => {
    const field = setup();
    await field.get("input").trigger("keydown", { key: "ArrowDown" });
    await field.get("input").trigger("keydown", { key: "ArrowDown" });
    await field.get("input").trigger("keydown", { key: "Enter" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["支付宝"]);
    expect(field.get("button").attributes("type")).toBe("button");
  });
  it("closes on outside pointer presses and Tab", async () => {
    const field = setup();
    await field.get("button").trigger("click");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await field.vm.$nextTick();
    expect(field.find('[role="listbox"]').exists()).toBe(false);
    await field.get("button").trigger("click");
    await field.get("input").trigger("keydown", { key: "Tab" });
    expect(field.find('[role="listbox"]').exists()).toBe(false);
  });
  it("updates available options when switching from expense to income", async () => {
    const field = setup();
    await field.get("button").trigger("click");
    await field.setProps({
      options: ["工资薪酬", "奖金收入"],
      modelValue: "工资薪酬",
    });
    expect(field.find('[role="listbox"]').exists()).toBe(false);
    await field.get("button").trigger("click");
    expect(
      field.findAll('[role="option"]').map((option) => option.text()),
    ).toEqual(["工资薪酬", "奖金收入"]);
  });
  it("offers adding a named option only when enabled, without submitting a form", async () => {
    const field = setup();
    expect(field.find('[aria-label="添加支付方式"]').exists()).toBe(false);
    await field.setProps({ allowAdd: true });
    await field.get('[aria-label="添加支付方式"]').trigger("click");
    expect(field.emitted("add")?.at(-1)).toEqual([""]);
    expect(field.get('[aria-label="添加支付方式"]').attributes("type")).toBe(
      "button",
    );
    await field.setProps({ modelValue: "家庭备用金" });
    await field.get('[aria-label="添加支付方式"]').trigger("click");
    expect(field.emitted("add")?.at(-1)).toEqual(["家庭备用金"]);
    await field.setProps({ disabled: true });
    await field.get('[aria-label="添加支付方式"]').trigger("click");
    expect(field.emitted("add")).toHaveLength(2);
  });
  it("shows icons for the current value and every option without replacing text labels", async () => {
    const field = setup();
    await field.setProps({ iconKind: "payment" });
    expect(
      field.get(".select-current-icon").attributes("data-option-icon"),
    ).toBe("message-circle");
    await field.get('[aria-label="展开支付方式选项"]').trigger("click");
    const options = field.findAll('[role="option"]');
    expect(options).toHaveLength(5);
    expect(
      options.every((option) => option.find("[data-option-icon]").exists()),
    ).toBe(true);
    expect(options[0].text()).toBe("微信");
    await options[3].trigger("click");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["现金"]);
    await field.setProps({ modelValue: "家庭备用金" });
    expect(
      field.get(".select-current-icon").attributes("data-option-icon"),
    ).toBe("wallet");
  });
  it("uses persisted custom icons for both the current value and dropdown options", async () => {
    const field = setup();
    await field.setProps({
      modelValue: "交通卡",
      options: ["交通卡", "微信"],
      iconKind: "payment",
      iconOverrides: { 交通卡: "credit-card" },
    });
    expect(
      field.get(".select-current-icon").attributes("data-option-icon"),
    ).toBe("credit-card");
    await field.get('[aria-label="展开支付方式选项"]').trigger("click");
    expect(
      field
        .get('[role="option"]')
        .get("[data-option-icon]")
        .attributes("data-option-icon"),
    ).toBe("credit-card");
  });
  it("handles a special-name icon mapping without using inherited properties", async () => {
    const field = setup();
    await field.setProps({
      modelValue: "__proto__",
      options: ["__proto__"],
      iconKind: "expense",
      iconOverrides: JSON.parse('{"__proto__":"paw-print"}'),
    });
    expect(
      field.get(".select-current-icon").attributes("data-option-icon"),
    ).toBe("paw-print");
    await field.setProps({ modelValue: "constructor", iconOverrides: {} });
    expect(
      field.get(".select-current-icon").attributes("data-option-icon"),
    ).toBe("tag");
  });
  it("stops Escape propagation while open, so it does not close the record modal", async () => {
    const field = setup();
    await field.get("button").trigger("click");
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    field.get("input").element.dispatchEvent(event);
    await field.vm.$nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(field.find('[role="listbox"]').exists()).toBe(false);
  });
});
