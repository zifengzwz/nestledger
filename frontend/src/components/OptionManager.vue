<script setup lang="ts">
import { computed, ref } from "vue";
import { api, type RecordOptions } from "../api";
import IconPicker from "./IconPicker.vue";
import OptionIcon from "./OptionIcon.vue";
import Modal from "./Modal.vue";

const props = defineProps<{ options: RecordOptions }>();
const emit = defineEmits<{ changed: [options: RecordOptions] }>();
type Tab = "expense" | "income" | "payment";
const tab = ref<Tab>("expense");
const busy = ref(false),
  error = ref(""),
  status = ref("");
const addOpen = ref(false);
const draft = ref({ name: "", icon: "tag" });
const subParent = ref("");
const subName = ref("");
const pendingDelete = ref<{
  kind: "major" | "sub";
  name: string;
  parent?: string;
  label: string;
} | null>(null);
const defaultIcons: Record<Tab, string> = {
  expense: "tag",
  income: "coins",
  payment: "wallet",
};
const tabLabels: Record<Tab, string> = {
  expense: "支出分类",
  income: "收入分类",
  payment: "支付方式",
};
const addLabels: Record<Tab, string> = {
  expense: "支出大分类",
  income: "收入大分类",
  payment: "支付方式",
};
const majorKind = computed(() =>
  tab.value === "expense"
    ? "expenseCategory"
    : tab.value === "income"
      ? "incomeCategory"
      : "paymentSource",
);
const subKind = computed(() =>
  tab.value === "expense" ? "expenseSubcategory" : "incomeSubcategory",
);
const optionKind = computed(() =>
  tab.value === "expense"
    ? "expense"
    : tab.value === "income"
      ? "income"
      : "payment",
);
const majors = computed(() =>
  tab.value === "expense"
    ? props.options.expenseCategories ?? []
    : tab.value === "income"
      ? props.options.incomeCategories ?? []
      : props.options.paymentSources ?? [],
);
const iconMap = computed(
  () => props.options.icons?.[majorKind.value] ?? {},
);
const subMap = computed(() =>
  tab.value === "expense"
    ? (props.options.expenseSubcategories ?? {})
    : tab.value === "income"
      ? (props.options.incomeSubcategories ?? {})
      : {},
);
const customSubMap = computed(() =>
  tab.value === "expense"
    ? (props.options.customExpenseSubcategories ?? {})
    : tab.value === "income"
      ? (props.options.customIncomeSubcategories ?? {})
      : {},
);
const hasOwn = (object: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);
const isCustomMajor = (name: string) => hasOwn(iconMap.value, name);
const isCustomSub = (parent: string, name: string) =>
  (customSubMap.value[parent] ?? []).includes(name);
const deleteTitle = computed(() =>
  pendingDelete.value ? `删除${pendingDelete.value.label}？` : "",
);
const deleteMessage = computed(() => {
  const target = pendingDelete.value;
  if (!target) return "";
  if (target.kind === "sub")
    return `确定删除小分类「${target.name}」？历史记录不会改变。`;
  if (target.label === "支付方式")
    return `确定删除支付方式「${target.name}」？历史记录不会改变。`;
  return `确定删除${target.label}「${target.name}」？它下面的自定义小分类也会一起删除，历史记录不会改变。`;
});
function setTab(next: Tab) {
  tab.value = next;
  addOpen.value = false;
  subParent.value = "";
  error.value = status.value = "";
  draft.value.icon = defaultIcons[next];
}
function openAdd() {
  addOpen.value = true;
  error.value = status.value = "";
  draft.value = { name: "", icon: defaultIcons[tab.value] };
}
async function addMajor() {
  const name = draft.value.name.trim();
  if (!name || busy.value) {
    if (!name) error.value = "名称不能为空";
    return;
  }
  busy.value = true;
  error.value = status.value = "";
  try {
    const updated = await api<RecordOptions>("/record-options", "POST", {
      kind: majorKind.value,
      name,
      icon: draft.value.icon,
    });
    emit("changed", updated);
    addOpen.value = false;
    status.value = `已添加${addLabels[tab.value]}「${name}」`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "添加失败，请重试";
  } finally {
    busy.value = false;
  }
}
function openSub(parent: string) {
  subParent.value = parent;
  subName.value = "";
  error.value = status.value = "";
}
async function addSub() {
  const name = subName.value.trim();
  const parent = subParent.value;
  if (!name || busy.value) {
    if (!name) error.value = "小分类名称不能为空";
    return;
  }
  busy.value = true;
  error.value = status.value = "";
  try {
    const updated = await api<RecordOptions>("/record-options", "POST", {
      kind: subKind.value,
      parent,
      name,
    });
    emit("changed", updated);
    status.value = `已为「${parent}」添加小分类「${name}」`;
    subParent.value = "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "添加失败，请重试";
  } finally {
    busy.value = false;
  }
}
async function removeMajor(name: string) {
  if (busy.value) return false;
  busy.value = true;
  error.value = status.value = "";
  try {
    const updated = await api<RecordOptions>(
      "/record-options/delete",
      "POST",
      { kind: majorKind.value, name },
    );
    emit("changed", updated);
    status.value = `已删除${addLabels[tab.value]}「${name}」，历史记录不受影响`;
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除失败，请重试";
    return false;
  } finally {
    busy.value = false;
  }
}
async function removeSub(parent: string, name: string) {
  if (busy.value) return false;
  busy.value = true;
  error.value = status.value = "";
  try {
    const updated = await api<RecordOptions>(
      "/record-options/delete",
      "POST",
      { kind: subKind.value, parent, name },
    );
    emit("changed", updated);
    status.value = `已删除小分类「${name}」，历史记录不受影响`;
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除失败，请重试";
    return false;
  } finally {
    busy.value = false;
  }
}
function requestDeleteMajor(name: string) {
  pendingDelete.value = {
    kind: "major",
    name,
    label: addLabels[tab.value],
  };
}
function requestDeleteSub(parent: string, name: string) {
  pendingDelete.value = { kind: "sub", name, parent, label: "小分类" };
}
async function confirmDelete() {
  const target = pendingDelete.value;
  if (!target || busy.value) return;
  const done =
    target.kind === "sub"
      ? await removeSub(target.parent ?? "", target.name)
      : await removeMajor(target.name);
  if (done) pendingDelete.value = null;
}
</script>

<template>
  <div class="option-manager">
    <div class="option-toolbar">
      <div class="segmented" aria-label="选项类型">
        <button
          v-for="(label, key) in tabLabels"
          :key="key"
          :class="{ active: tab === key }"
          @click="setTab(key as Tab)"
        >
          {{ label }}
        </button>
      </div>
      <button class="primary" :disabled="busy" @click="openAdd">
        + 添加{{ addLabels[tab] }}
      </button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="status" class="option-status" role="status">{{ status }}</p>
    <form v-if="addOpen" class="option-add-form" @submit.prevent="addMajor">
      <label>名称<input v-model="draft.name" maxlength="40" required /></label>
      <IconPicker v-model="draft.icon" :disabled="busy" />
      <div class="button-row">
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="addOpen = false"
        >
          取消
        </button>
        <button class="primary" :disabled="busy || !draft.name.trim()">
          {{ busy ? "保存中…" : "保存" }}
        </button>
      </div>
    </form>
    <div class="option-list">
      <article v-for="major in majors" :key="major" class="option-card">
        <header class="option-row">
          <span class="option-icon"
            ><OptionIcon
              :kind="optionKind"
              :name="major"
              :icon="iconMap[major]"
              :size="18"
          /></span>
          <div class="option-name">
            <strong>{{ major }}</strong>
            <small :class="isCustomMajor(major) ? 'custom' : 'default'">{{
              isCustomMajor(major) ? "自定义" : "默认"
            }}</small>
          </div>
          <button
            v-if="isCustomMajor(major)"
            class="text-button danger-text"
            :disabled="busy"
            @click="requestDeleteMajor(major)"
          >
            删除
          </button>
        </header>
        <div v-if="tab !== 'payment'" class="subcategories">
          <span
            v-for="sub in subMap[major] ?? []"
            :key="sub"
            class="sub-chip"
          >
            {{ sub }}
            <button
              v-if="isCustomSub(major, sub)"
              type="button"
              :aria-label="`删除小分类${sub}`"
              :disabled="busy"
              @click="requestDeleteSub(major, sub)"
            >
              ×
            </button>
          </span>
          <button
            class="text-button add-sub"
            :disabled="busy"
            @click="openSub(major)"
          >
            + 小分类
          </button>
        </div>
        <form
          v-if="tab !== 'payment' && subParent === major"
          class="option-sub-form"
          @submit.prevent="addSub"
        >
          <input
            v-model="subName"
            maxlength="40"
            :aria-label="`为${major}添加小分类`"
            placeholder="新小分类名称"
            required
          />
          <button class="primary" :disabled="busy || !subName.trim()">
            添加
          </button>
          <button
            type="button"
            class="secondary"
            @click="subParent = ''"
          >
            取消
          </button>
        </form>
      </article>
      <p v-if="!majors.length" class="muted">还没有可管理的选项。</p>
    </div>
    <Modal
      v-if="pendingDelete"
      :title="deleteTitle"
      :busy="busy"
      @close="pendingDelete = null"
    >
      <p class="confirm-message">{{ deleteMessage }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions">
        <button
          class="secondary"
          :disabled="busy"
          @click="pendingDelete = null"
        >
          取消
        </button>
        <button class="danger" :disabled="busy" @click="confirmDelete">
          {{ busy ? "正在删除…" : "确定删除" }}
        </button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.option-manager {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.option-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.option-status {
  color: var(--green-dark);
  font-size: 12px;
  margin: 0;
}
.option-add-form {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--surface));
  border-radius: 14px;
  padding: 18px;
}
.option-add-form .button-row {
  justify-content: flex-end;
  margin-top: 12px;
}
.option-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.option-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 18px;
}
.option-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  flex-shrink: 0;
}
.option-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.option-name strong {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-name small {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 5px;
}
.option-name small.default {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.option-name small.custom {
  color: var(--green-dark);
  background: color-mix(in srgb, var(--green) 12%, var(--surface));
}
.subcategories {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 12px 0 0 44px;
}
.sub-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  color: var(--text);
  font-size: 11px;
}
.sub-chip button {
  border: 0;
  background: transparent;
  color: var(--danger);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.add-sub {
  font-size: 11px;
  padding: 2px 4px;
}
.option-sub-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 0 44px;
}
.option-sub-form input {
  flex: 1;
  min-height: 36px;
  padding: 6px 10px;
  font-size: 12px;
}
.option-sub-form button {
  min-height: 36px;
  padding: 6px 12px;
  font-size: 12px;
}
@media (max-width: 720px) {
  .subcategories,
  .option-sub-form {
    margin-left: 0;
  }
  .option-sub-form {
    flex-wrap: wrap;
  }
  .option-sub-form input {
    flex-basis: 100%;
  }
}
</style>