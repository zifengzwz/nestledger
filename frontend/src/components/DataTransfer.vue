<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Download, Upload, Check, Leaf } from "lucide-vue-next";
import Modal from "./Modal.vue";
import { api, type Book } from "../api";
import {
  centsDecimal,
  downloadText,
  exportDateRange,
  importBody,
  MAX_TRANSFER_BYTES,
  newRequestId,
  parseImportFile,
  parseJSONBackup,
  recordsCSV,
  safeFilename,
  templateCSV,
  type Backup,
  type ParsedImport,
} from "../dataTransfer";
const props = defineProps<{ book: Book; mode: "import" | "export" }>();
const emit = defineEmits<{
  close: [];
  imported: [bookId: string, count: number];
  failure: [error: unknown];
  downloaded: [message: string];
}>();
const from = ref("");
const to = ref("");
const busy = ref(false);
const error = ref("");
const filename = ref("");
const parsed = ref<ParsedImport | null>(null);
const validated = ref(false);
const completed = ref(false);
const requestId = ref("");
const fileInput = ref<HTMLInputElement>();
let generation = 0;
let alive = true;
let sourceText = "";
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
function reset() {
  generation++;
  filename.value = "";
  parsed.value = null;
  validated.value = false;
  completed.value = false;
  requestId.value = "";
  sourceText = "";
  busy.value = false;
  if (fileInput.value) fileInput.value.value = "";
}
watch(
  () => props.book.id,
  () => {
    reset();
    error.value = "目标账本已切换，请重新选择文件并校验，避免导入错账本。";
  },
  { flush: "sync" },
);
function current(sequence: number, id: string) {
  return alive && sequence === generation && id === props.book.id;
}
function report(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : "操作失败，请重试";
  emit("failure", cause);
}
async function readFile(file: File): Promise<string> {
  // Read bytes as fatal UTF8, instead of silently replacing malformed input.
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(new Error("无法读取文件，请重新选择"));
          reader.readAsArrayBuffer(file);
        });
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("文件不是有效UTF8文本，请另存为UTF8 CSV或JSON");
  }
}
async function chooseFile(event: Event) {
  if (busy.value) return;
  const file = (event.target as HTMLInputElement).files?.[0];
  const previous = {
    name: filename.value,
    text: sourceText,
    token: requestId.value,
  };
  reset();
  error.value = "";
  if (!file) return;
  const sequence = generation,
    id = props.book.id;
  filename.value = file.name;
  busy.value = true;
  try {
    if (file.size > MAX_TRANSFER_BYTES) throw new Error("文件不能超过10MiB");
    if (!/\.(csv|json)$/i.test(file.name))
      throw new Error("请选择.csv或.json文件");
    const text = await readFile(file);
    const result = parseImportFile(text, file.name);
    const token =
      previous.token && previous.name === file.name && previous.text === text
        ? previous.token
        : newRequestId();
    importBody(token, result.records, true);
    if (!current(sequence, id)) return;
    requestId.value = token;
    sourceText = text;
    parsed.value = result;
  } catch (cause) {
    if (current(sequence, id)) report(cause);
  } finally {
    if (current(sequence, id)) busy.value = false;
  }
}
const totals = computed(() => {
  let income = 0,
    expense = 0;
  for (const row of parsed.value?.records || []) {
    if (row.type === "income") income += row.amountCents;
    else expense += row.amountCents;
  }
  return { income, expense };
});
async function validate() {
  if (busy.value || !parsed.value || completed.value) return;
  const sequence = generation,
    id = props.book.id;
  busy.value = true;
  error.value = "";
  validated.value = false;
  try {
    const result = await api<{
      validated: boolean;
      count: number;
      dryRun: boolean;
    }>(
      `/books/${id}/import`,
      "POST",
      importBody(requestId.value, parsed.value.records, true),
    );
    if (!current(sequence, id)) return;
    if (
      result.validated !== true ||
      result.dryRun !== true ||
      result.count !== parsed.value.records.length
    )
      throw new Error("服务器校验结果异常，未允许导入，请重试");
    validated.value = true;
  } catch (cause) {
    if (current(sequence, id)) report(cause);
  } finally {
    if (current(sequence, id)) busy.value = false;
  }
}
async function commit() {
  if (busy.value || !parsed.value || !validated.value || completed.value)
    return;
  const sequence = generation,
    id = props.book.id,
    rows = parsed.value.records;
  busy.value = true;
  error.value = "";
  try {
    const result = await api<{
      importedCount: number;
      replayed: boolean;
      requestId: string;
    }>(`/books/${id}/import`, "POST", importBody(requestId.value, rows, false));
    if (!current(sequence, id)) return;
    if (
      result.requestId !== requestId.value ||
      result.importedCount !== rows.length ||
      typeof result.replayed !== "boolean"
    )
      throw new Error("服务器结果异常；请用当前文件重试，重试不会重复追加");
    completed.value = true;
    validated.value = false;
    emit("imported", id, result.importedCount);
  } catch (cause) {
    if (current(sequence, id)) report(cause);
  } finally {
    if (current(sequence, id)) busy.value = false;
  }
}
async function exportFile(format: "csv" | "json") {
  if (busy.value) return;
  const sequence = generation,
    id = props.book.id,
    bookName = props.book.name;
  busy.value = true;
  error.value = "";
  try {
    const query = exportDateRange(from.value, to.value).toString();
    const result = await api<Backup>(
      `/books/${id}/export${query ? "?" + query : ""}`,
    );
    if (!current(sequence, id)) return;
    // Validate the real response, never synthesize data if the server fails.
    const clean = parseJSONBackup(JSON.stringify(result), true);
    const backup: Backup = {
      format: "nestledger",
      version: 1,
      exportedAt: result.exportedAt,
      book: { name: result.book.name, type: result.book.type },
      records: clean.records,
    };
    downloadText(
      format === "csv"
        ? recordsCSV(clean.records)
        : JSON.stringify(backup, null, 2),
      `${safeFilename(bookName)}-备份.${format}`,
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "application/json;charset=utf-8",
    );
    emit(
      "downloaded",
      `已导出${clean.records.length}笔记录（${format.toUpperCase()}）`,
    );
  } catch (cause) {
    if (current(sequence, id)) report(cause);
  } finally {
    if (current(sequence, id)) busy.value = false;
  }
}
function downloadTemplate() {
  try {
    downloadText(
      templateCSV(),
      "NestLedger-导入模板.csv",
      "text/csv;charset=utf-8",
    );
  } catch (cause) {
    report(cause);
  }
}
</script>
<template>
  <Modal
    class="transfer-dialog"
    :title="mode === 'export' ? '导出账本' : '导入账本'"
    :busy="busy"
    @close="emit('close')"
  >
    <div class="data-transfer">
      <div class="transfer-target">
        <Leaf :size="20" />
        <div>
          <strong>{{ book.name }}</strong>
          <p class="tiny muted">
            {{ mode === "import" ? "目标账本" : "当前账本" }} ·
            {{ book.type === "family" ? "家庭账本" : "个人账本" }}
          </p>
        </div>
      </div>
      <template v-if="mode === 'export'">
        <p class="muted">
          备份当前账本的记录，不包含账号、成员或个人设置。每次最多5000笔，超限请缩小日期范围。
        </p>
        <div class="form-grid transfer-dates">
          <label
            >导出开始日期<input
              v-model="from"
              type="date"
              :disabled="busy"
              aria-label="导出开始日期"
          /></label>
          <label
            >导出结束日期<input
              v-model="to"
              type="date"
              :disabled="busy"
              aria-label="导出结束日期"
          /></label>
        </div>
        <p class="tiny muted">
          日期选填，按北京时间，包含开始与结束当天；留空则导出全部日期。
        </p>
        <div class="transfer-actions">
          <button class="primary" :disabled="busy" @click="exportFile('csv')">
            <Download :size="17" />下载 CSV
          </button>
          <button
            class="secondary"
            :disabled="busy"
            @click="exportFile('json')"
          >
            <Download :size="17" />下载 JSON
          </button>
          <button
            class="text-button"
            :disabled="busy"
            @click="downloadTemplate"
          >
            下载 CSV 模板
          </button>
        </div>
        <div class="info-note">
          <p>
            JSON保留六个原始字段。CSV为Excel防护会给危险文本添加单引号；本平台导入时仅还原该模式。手写文本若本来以单引号加危险字符开头可能有歧义，精确保真请使用JSON。
          </p>
        </div>
      </template>
      <template v-else>
        <p class="muted">
          仅追加到当前账本，不覆盖旧记录。导入记录归当前登录者；不会创建账本、加入源账本或修改常用选项。
        </p>
        <div class="transfer-actions">
          <button class="secondary" :disabled="busy" @click="downloadTemplate">
            <Download :size="17" />下载 CSV 模板
          </button>
        </div>
        <label class="transfer-file"
          >选择导入文件<input
            ref="fileInput"
            type="file"
            accept=".csv,.json"
            aria-label="选择导入文件"
            :disabled="busy"
            @change="chooseFile"
        /></label>
        <p class="tiny muted">
          UTF8 CSV或NestLedger JSON版本1 · 单次1–5000笔 ·
          文件及请求均不超过10MiB。模板含一笔示例，导入前请修改或删除。CSV时间可填写ISO8601或北京时间
          YYYY-MM-DD HH:mm[:ss]。
        </p>
        <p v-if="filename" class="transfer-filename">文件：{{ filename }}</p>
        <template v-if="parsed">
          <p v-if="parsed.sourceBook" class="tiny muted">
            源账本：{{ parsed.sourceBook }}（仅作参考，仍导入到上方目标账本）
          </p>
          <div class="transfer-summary" aria-live="polite">
            <strong>共 {{ parsed.records.length }} 笔</strong
            ><span>收入 ¥{{ centsDecimal(totals.income) }}</span
            ><span>支出 ¥{{ centsDecimal(totals.expense) }}</span>
          </div>
          <p class="tiny muted">
            本地预览（前10笔），尚未写入；必须通过服务器校验后手动确认。
          </p>
          <div class="table-wrap transfer-preview">
            <table>
              <thead>
                <tr>
                  <th>行号</th>
                  <th>类型 / 分类</th>
                  <th>金额（元）</th>
                  <th>时间</th>
                  <th>备注 / 支付方式</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in parsed.records.slice(0, 10)"
                  :key="index"
                >
                  <td>{{ parsed.lines[index] }}</td>
                  <td>
                    {{ row.type === "income" ? "收入" : "支出" }}<br />{{
                      row.category
                    }}
                  </td>
                  <td>{{ centsDecimal(row.amountCents) }}</td>
                  <td>{{ row.occurredAt }}</td>
                  <td>
                    {{ row.note }}<br /><small>{{ row.paymentSource }}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="validated" class="transfer-success" role="status">
            <Check :size="17" />服务器校验通过，可以确认追加到「{{
              book.name
            }}」。
          </p>
          <p v-if="completed" class="transfer-success" role="status">
            <Check :size="17" />导入完成，正在更新记录与收支分析。
          </p>
          <div class="transfer-actions">
            <button
              class="secondary"
              :disabled="busy || completed"
              @click="validate"
            >
              校验并预览
            </button>
            <button
              class="primary"
              :disabled="busy || !validated || completed"
              @click="commit"
            >
              <Upload :size="17" />确认导入
            </button>
          </div>
          <p class="tiny muted">
            确认会追加 {{ parsed.records.length }} 笔到「{{
              book.name
            }}」，不覆盖任何历史数据。网络失败可用当前文件重试，保留同一请求标识以避免重复；切换文件或目标账本需重新校验。
          </p>
          <p class="transfer-request-id tiny muted">
            本次导入标识：<code>{{ requestId }}</code
            >（异常时请保留此标识）
          </p>
        </template>
      </template>
      <p v-if="busy" role="status" class="muted">正在处理，请稍候…</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions">
        <button class="secondary" :disabled="busy" @click="emit('close')">
          {{ completed ? "完成" : "取消" }}
        </button>
      </div>
    </div>
  </Modal>
</template>
<style scoped>
.transfer-dialog :deep(.modal) {
  max-width: 720px;
}
.data-transfer {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.transfer-target {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 13%, var(--surface)), color-mix(in srgb, var(--accent) 9%, var(--surface)));
  border: 1px solid color-mix(in srgb, var(--accent) 15%, var(--surface));
  border-radius: 14px;
  color: var(--green);
  overflow-wrap: anywhere;
}
.transfer-dates {
  margin-top: 3px;
}
.transfer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.transfer-filename {
  overflow-wrap: anywhere;
  font-size: 13px;
}
.transfer-file input {
  padding: 12px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  border-color: var(--accent-light);
  border-radius: 12px;
  border-style: dashed;
}
.transfer-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  background: color-mix(in srgb, var(--accent) 11%, var(--surface));
  color: var(--accent-strong);
  font-variant-numeric: tabular-nums;
  border-radius: 12px;
  padding: 12px;
}
.transfer-preview {
  max-height: 280px;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.transfer-preview table {
  width: 100%;
  min-width: 600px;
  font-size: 12px;
}
.transfer-preview td {
  max-width: 230px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.transfer-request-id {
  overflow-wrap: anywhere;
}
.transfer-request-id code {
  white-space: normal;
  font-size: 10px;
}
.transfer-success {
  display: flex;
  gap: 6px;
  color: var(--green);
  font-size: 13px;
  align-items: flex-start;
  padding: 12px;
  background: color-mix(in srgb, var(--accent) 11%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--surface));
  border-radius: 12px;
}
@media (max-width: 560px) {
  .transfer-dates {
    grid-template-columns: 1fr;
  }
  .transfer-actions button {
    flex: 1 1 auto;
  }
}
</style>
