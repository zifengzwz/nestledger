<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-vue-next";
import OptionIcon from "./OptionIcon.vue";
import type { OptionIconKind } from "../optionIcons";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    options: string[];
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    allowAdd?: boolean;
    removable?: boolean;
    iconKind?: OptionIconKind;
    iconOverrides?: Record<string, string>;
  }>(),
  { required: true, disabled: false, removable: false },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  add: [suggestedName: string];
  remove: [];
}>();
function savedIcon(name: string) {
  const value = name.trim();
  return props.iconOverrides &&
    Object.prototype.hasOwnProperty.call(props.iconOverrides, value)
    ? props.iconOverrides[value]
    : undefined;
}
function requestAdd() {
  if (props.disabled) return;
  open.value = false;
  const name = props.modelValue.trim();
  emit("add", props.options.includes(name) ? "" : name);
}
function requestRemove() {
  if (props.disabled) return;
  open.value = false;
  emit("remove");
}
const id = useId();
const root = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const open = ref(false);
const query = ref("");
const active = ref(-1);
const filtered = computed(() =>
  props.options.filter((option) =>
    option.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
);

function expand() {
  if (props.disabled) return;
  // Opening a prefilled field must show all choices, not just its current value.
  query.value = "";
  active.value = -1;
  open.value = true;
}
function toggle() {
  const wasOpen = open.value;
  input.value?.focus();
  if (wasOpen) open.value = false;
  else expand();
}
function change(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", value);
  query.value = value;
  active.value = -1;
  open.value = true;
}
function choose(value: string) {
  emit("update:modelValue", value);
  query.value = "";
  open.value = false;
  active.value = -1;
  input.value?.focus();
  // focus can open the list if a pointer had focused another element.
  open.value = false;
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation(); // Close this list before the enclosing modal.
    open.value = false;
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) expand();
    const size = filtered.value.length;
    if (!size) return;
    active.value =
      event.key === "ArrowDown"
        ? (active.value + 1) % size
        : active.value <= 0
          ? size - 1
          : active.value - 1;
    root.value
      ?.querySelector<HTMLElement>(`[id="${id}-option-${active.value}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  } else if (event.key === "Enter" && open.value && active.value >= 0) {
    event.preventDefault();
    choose(filtered.value[active.value]);
  } else if (event.key === "Tab") {
    open.value = false;
  }
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
function blur(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null))
    open.value = false;
}
watch(
  () => props.options,
  () => {
    open.value = false;
    active.value = -1;
    query.value = "";
  },
);
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div class="select-input-field">
    <div class="select-input-heading">
      <label :for="`${id}-input`">{{ label }}</label>
      <div v-if="allowAdd || removable" class="select-input-actions">
        <button
          v-if="allowAdd"
          type="button"
          class="select-input-add"
          :aria-label="`添加${label}`"
          :disabled="disabled"
          @click="requestAdd"
        >
          <Plus :size="12" />添加
        </button>
        <button
          v-if="removable"
          type="button"
          class="select-input-remove"
          :aria-label="`删除${label}`"
          :disabled="disabled"
          @click="requestRemove"
        >
          <Trash2 :size="12" />删除
        </button>
      </div>
    </div>
    <div
      ref="root"
      class="select-input"
      :class="{ 'has-icon': !!iconKind }"
      @focusout="blur"
    >
      <OptionIcon
        v-if="iconKind"
        :kind="iconKind"
        :name="modelValue"
        :icon="savedIcon(modelValue)"
        :size="17"
        class="select-current-icon"
      />
      <input
        :id="`${id}-input`"
        ref="input"
        :value="modelValue"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        maxlength="40"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="`${id}-list`"
        :aria-activedescendant="
          open && active >= 0 ? `${id}-option-${active}` : undefined
        "
        @input="change"
        @focus="expand"
        @click="!open && expand()"
        @keydown="keyboard"
      />
      <button
        type="button"
        class="select-input-toggle"
        :aria-label="`展开${label}选项`"
        :aria-expanded="open"
        :aria-controls="`${id}-list`"
        :disabled="disabled"
        @pointerdown.prevent
        @click="toggle"
        @keydown="keyboard"
      >
        <ChevronDown :size="18" />
      </button>
      <ul
        v-if="open"
        :id="`${id}-list`"
        class="select-input-options"
        role="listbox"
        :aria-label="`${label}选项`"
      >
        <li
          v-for="(option, index) in filtered"
          :id="`${id}-option-${index}`"
          :key="option"
          role="option"
          :aria-selected="modelValue === option"
          :class="{ active: active === index }"
          @pointerdown.prevent
          @click="choose(option)"
        >
          <span class="select-option-label"
            ><OptionIcon
              v-if="iconKind"
              :kind="iconKind"
              :name="option"
              :icon="savedIcon(option)"
              :size="17"
            />{{ option }}</span
          ><Check v-if="modelValue === option" :size="16" />
        </li>
        <li
          v-if="!filtered.length"
          class="select-input-empty"
          role="presentation"
        >
          暂无匹配选项，可直接输入
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.select-input-field {
  min-width: 0;
}
.select-input-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.select-input-heading > label {
  margin: 0;
}
.select-input-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.select-input-add {
  padding: 2px 4px;
  font-size: 10px;
  color: var(--green);
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.select-input-add:hover {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.select-input-remove {
  padding: 2px 4px;
  font-size: 10px;
  color: var(--danger);
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.select-input-remove:hover {
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
}
.select-input {
  position: relative;
}
.select-input input {
  width: 100%;
  padding-right: 44px;
}
.select-input.has-icon input {
  padding-left: 38px;
}
.select-current-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent-strong);
  pointer-events: none;
}
.select-option-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.select-input-toggle {
  position: absolute;
  right: 1px;
  top: 1px;
  bottom: 1px;
  width: 40px;
  border: 0;
  border-radius: 0 9px 9px 0;
  background: transparent;
  color: var(--green);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
}
.select-input-toggle:hover {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.select-input-options {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  right: 0;
  z-index: 5;
  max-height: 200px;
  overflow-y: auto;
  list-style: none;
  padding: 5px;
  margin: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-raised);
}
.select-input-options [role="option"] {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 10px;
  min-height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--accent-strong);
}
.select-input-options [role="option"]:hover,
.select-input-options .active {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.select-input-options [aria-selected="true"] {
  color: var(--green);
  font-weight: 600;
}
.select-input-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--text);
}
</style>
