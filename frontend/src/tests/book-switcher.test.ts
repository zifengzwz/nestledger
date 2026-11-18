import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import BookSwitcher from "../components/BookSwitcher.vue";
import type { Book } from "../api";

const books: Book[] = Array.from({ length: 7 }, (_, index) => ({
  id: `b${index + 1}`,
  name: `账本 ${index + 1}`,
  type: index % 2 ? "family" : "personal",
  ownerId: "u1",
  memberIds: ["u1"],
  createdAt: "2026-11-17T00:00:00Z",
}));
let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});
function setup() {
  wrapper = mount(BookSwitcher, {
    props: { books, modelValue: "b2" },
    attachTo: document.body,
  });
  return wrapper;
}
describe("sidebar book switcher", () => {
  it("keeps every book selectable and explains scrolling after five", () => {
    const field = setup();
    expect(field.findAll('[role="option"]')).toHaveLength(7);
    expect(field.text()).toContain("最多显示 5 本，滚动查看更多");
    expect(field.get('[aria-selected="true"]').text()).toContain("账本 2");
    expect(
      field.get('[role="listbox"]').attributes("aria-labelledby"),
    ).toBeDefined();
  });
  it("switches books on click without submitting a form", async () => {
    const field = setup();
    await field.findAll('[role="option"]')[5].trigger("click");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["b6"]);
    expect(
      field
        .findAll("button")
        .every((button) => button.attributes("type") === "button"),
    ).toBe(true);
  });
  it("supports arrows, Home and End and roving keyboard focus", async () => {
    const field = setup();
    const selected = field.get('[aria-selected="true"]');
    expect(selected.attributes("tabindex")).toBe("0");
    await selected.trigger("keydown", { key: "ArrowDown" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["b3"]);
    expect(document.activeElement).toBe(
      field.findAll('[role="option"]')[2].element,
    );
    await selected.trigger("keydown", { key: "End" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["b7"]);
    await selected.trigger("keydown", { key: "Home" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["b1"]);
  });
  it("shows all names and types and highlights only the current book", async () => {
    const field = setup();
    expect(field.findAll('[aria-selected="true"]')).toHaveLength(1);
    await field.setProps({ modelValue: "b7" });
    expect(field.get('[aria-selected="true"]').text()).toContain("账本 7");
    expect(field.findAll('[role="option"]')[1].attributes("title")).toBe(
      "账本 2 · 家庭",
    );
    await field.setProps({ books: books.slice(0, 5), modelValue: "b1" });
    expect(field.findAll('[role="option"]')).toHaveLength(5);
    expect(field.find(".book-scroll-hint").exists()).toBe(false);
  });
  it("moves books with arrow buttons without changing the selected book", async () => {
    const field = setup();
    await field.get('[aria-label="调整账本顺序"]').trigger("click");
    expect(field.findAll('[role="listitem"]')).toHaveLength(7);
    expect(
      field.get('[aria-label="上移账本 1"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      field.get('[aria-label="下移账本 7"]').attributes("disabled"),
    ).toBeDefined();
    await field.get('[aria-label="下移账本 1"]').trigger("click");
    expect(field.emitted("reorder")?.at(-1)).toEqual([
      ["b2", "b1", "b3", "b4", "b5", "b6", "b7"],
    ]);
    expect(field.emitted("update:modelValue")).toBeUndefined();
    await field.get('[aria-label="上移账本 3"]').trigger("click");
    expect(field.emitted("reorder")?.at(-1)).toEqual([
      ["b1", "b3", "b2", "b4", "b5", "b6", "b7"],
    ]);
  });
  it("persists a dragged row order and ignores external or same-row drops", async () => {
    const field = setup();
    await field.get('[aria-label="调整账本顺序"]').trigger("click");
    const rows = field.findAll('[role="listitem"]');
    await rows[2].trigger("drop");
    expect(field.emitted("reorder")).toBeUndefined();
    await rows[0].trigger("dragstart");
    await rows[2].trigger("drop");
    expect(field.emitted("reorder")?.at(-1)).toEqual([
      ["b2", "b3", "b1", "b4", "b5", "b6", "b7"],
    ]);
    await rows[1].trigger("dragstart");
    await rows[1].trigger("drop");
    expect(field.emitted("reorder")).toHaveLength(1);
  });
  it("disables sorting controls while saving and exits sort mode when only one book remains", async () => {
    const field = setup();
    await field.get('[aria-label="调整账本顺序"]').trigger("click");
    await field.setProps({ saving: true });
    expect(
      field.get('[aria-label="完成账本排序"]').attributes("disabled"),
    ).toBeDefined();
    expect(field.findAll('[role="listitem"]')[0].attributes("draggable")).toBe(
      "false",
    );
    await field.get('[aria-label="下移账本 1"]').trigger("click");
    expect(field.emitted("reorder")).toBeUndefined();
    await field.setProps({
      saving: false,
      books: books.slice(0, 1),
      modelValue: "b1",
    });
    expect(field.find('[role="listbox"]').exists()).toBe(true);
    expect(field.find(".book-sort-toggle").exists()).toBe(false);
  });
  it("handles an empty account without pretending there are books", () => {
    wrapper = mount(BookSwitcher, { props: { books: [], modelValue: "" } });
    expect(wrapper.text()).toContain("还没有账本");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.find(".book-scroll-hint").exists()).toBe(false);
  });
});
