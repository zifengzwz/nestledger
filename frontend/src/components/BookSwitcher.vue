<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  GripVertical,
  Users,
} from "lucide-vue-next";
import type { Book } from "../api";
const props = withDefaults(
  defineProps<{ books: Book[]; modelValue: string; saving?: boolean }>(),
  { saving: false },
);
const emit = defineEmits<{
  "update:modelValue": [id: string];
  reorder: [ids: string[]];
}>();
const sorting = ref(false);
const dragged = ref("");
const dropTarget = ref("");
function reorder(from: number, to: number) {
  if (
    props.saving ||
    from < 0 ||
    to < 0 ||
    to >= props.books.length ||
    from === to
  )
    return;
  const ids = props.books.map((book) => book.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  emit("reorder", ids);
}
function dragStart(event: DragEvent, bookId: string) {
  if (props.saving) {
    event.preventDefault();
    return;
  }
  dragged.value = bookId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bookId);
  }
}
function finishDrag() {
  dragged.value = "";
  dropTarget.value = "";
}
function drop(bookId: string) {
  const from = props.books.findIndex((book) => book.id === dragged.value);
  const to = props.books.findIndex((book) => book.id === bookId);
  finishDrag();
  reorder(from, to);
}
watch(
  () => props.books.length,
  (count) => {
    if (count < 2) sorting.value = false;
  },
);
const id = useId();
const list = ref<HTMLElement>();
function select(book: Book) {
  emit("update:modelValue", book.id);
}
function reveal(option?: HTMLElement | null) {
  const container = list.value;
  if (!container || !option || !container.clientHeight) return;
  const top = option.offsetTop;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (
    top + option.offsetHeight >
    container.scrollTop + container.clientHeight
  )
    container.scrollTop = top + option.offsetHeight - container.clientHeight;
}
function keyboard(event: KeyboardEvent, index: number) {
  let target: number;
  if (event.key === "ArrowDown") target = (index + 1) % props.books.length;
  else if (event.key === "ArrowUp")
    target = (index + props.books.length - 1) % props.books.length;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = props.books.length - 1;
  else return;
  event.preventDefault();
  select(props.books[target]);
  const option =
    list.value?.querySelectorAll<HTMLElement>('[role="option"]')[target];
  option?.focus({ preventScroll: true });
  reveal(option);
}
watch(
  () => [props.modelValue, props.books] as const,
  async () => {
    await nextTick();
    reveal(list.value?.querySelector<HTMLElement>('[aria-selected="true"]'));
  },
  { immediate: true },
);
</script>

<template>
  <div class="book-switcher">
    <div class="book-switcher-heading">
      <span :id="`${id}-label`">当前账本</span>
      <div class="book-heading-actions">
        <span v-if="books.length" class="book-total"
          >{{ books.length }} 本</span
        >
        <button
          v-if="books.length > 1"
          type="button"
          class="book-sort-toggle"
          :aria-label="sorting ? '完成账本排序' : '调整账本顺序'"
          :aria-pressed="sorting"
          :disabled="saving"
          @click="sorting = !sorting"
        >
          {{ saving ? "保存中…" : sorting ? "完成" : "排序" }}
        </button>
      </div>
    </div>
    <div
      ref="list"
      class="book-list"
      :role="sorting ? 'list' : 'listbox'"
      :aria-label="sorting ? '调整账本顺序' : undefined"
      :aria-labelledby="sorting ? undefined : `${id}-label`"
      :aria-busy="saving"
    >
      <template v-if="sorting">
        <div
          v-for="(book, index) in books"
          :key="book.id"
          class="book-order-row"
          role="listitem"
          :class="{
            current: book.id === modelValue,
            dragging: dragged === book.id,
            'drop-target': dropTarget === book.id,
          }"
          :title="book.name"
          :draggable="!saving"
          @dragstart="dragStart($event, book.id)"
          @dragend="finishDrag"
          @dragover.prevent="dropTarget = book.id"
          @drop.prevent="drop(book.id)"
        >
          <GripVertical
            :size="16"
            class="book-drag-handle"
            aria-hidden="true"
          />
          <span class="book-name">{{ book.name }}</span>
          <span class="book-order-controls">
            <button
              type="button"
              :aria-label="`上移${book.name}`"
              :disabled="saving || index === 0"
              @click="reorder(index, index - 1)"
            >
              <ArrowUp :size="15" />
            </button>
            <button
              type="button"
              :aria-label="`下移${book.name}`"
              :disabled="saving || index === books.length - 1"
              @click="reorder(index, index + 1)"
            >
              <ArrowDown :size="15" />
            </button>
          </span>
        </div>
      </template>
      <template v-else>
        <button
          v-for="(book, index) in books"
          :key="book.id"
          class="book-option"
          type="button"
          role="option"
          :aria-selected="book.id === modelValue"
          :title="`${book.name} · ${book.type === 'family' ? '家庭' : '个人'}`"
          :tabindex="
            book.id === modelValue || (!modelValue && index === 0) ? 0 : -1
          "
          @click="select(book)"
          @keydown="keyboard($event, index)"
        >
          <component
            :is="book.type === 'family' ? Users : BookOpen"
            :size="17"
          />
          <span class="book-name">{{ book.name }}</span>
          <span class="book-kind">{{
            book.type === "family" ? "家庭" : "个人"
          }}</span>
          <Check
            v-if="book.id === modelValue"
            :size="14"
            class="book-selected"
          />
        </button>
        <p v-if="!books.length" class="book-empty">还没有账本</p>
      </template>
    </div>
    <p v-if="sorting" class="book-sort-hint" aria-live="polite">
      {{ saving ? "正在保存顺序…" : "拖拽或用箭头调整，自动保存" }}
    </p>
    <p v-if="books.length > 5" class="book-scroll-hint">
      最多显示 5 本，滚动查看更多
    </p>
  </div>
</template>

<style scoped>
.book-switcher {
  min-width: 0;
}
.book-switcher-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  letter-spacing: 1.2px;
  color: var(--text);
  margin-bottom: 8px;
}
.book-total {
  letter-spacing: 0;
}
.book-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.book-sort-toggle {
  padding: 2px 4px;
  background: transparent;
  color: var(--green);
  font-size: 11px;
  border-radius: 4px;
}
.book-sort-toggle:hover {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
}
.book-order-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 48px;
  min-height: 48px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--accent-strong);
}
.book-order-row.current {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
  color: var(--accent-strong);
}
.book-order-row.dragging {
  opacity: 0.45;
}
.book-order-row.drop-target {
  border-color: var(--muted);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.book-drag-handle {
  flex-shrink: 0;
  cursor: grab;
}
.book-order-controls {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}
.book-order-controls button {
  width: 28px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--accent-strong);
  border-radius: 5px;
}
.book-order-controls button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 19%, var(--surface));
}
.book-order-controls button:disabled {
  opacity: 0.3;
  cursor: default;
}
.book-sort-hint {
  margin: 7px 0 0;
  color: var(--text);
  font-size: 11px;
}
.book-list {
  position: relative;
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--muted) transparent;
}
.book-option {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 48px;
  min-height: 48px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--accent-strong);
  text-align: left;
}
.book-option:hover {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.book-option[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--surface));
  box-shadow: inset 3px 0 0 var(--accent-light);
  font-weight: 600;
}
.book-option > svg {
  flex-shrink: 0;
}
.book-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
}
.book-kind {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 5px;
  background: var(--surface);
  border-radius: 4px;
  color: var(--text);
}
.book-selected {
  color: var(--accent-strong);
}
.book-scroll-hint {
  margin: 7px 0 0;
  font-size: 11px;
  color: var(--text);
}
.book-empty {
  margin: 0;
  padding: 12px 9px;
  font-size: 13px;
  color: var(--text);
  background: var(--surface);
  border-radius: 10px;
}
</style>
