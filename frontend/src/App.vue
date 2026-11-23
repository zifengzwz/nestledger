<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Home,
  Leaf,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  Tags,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-vue-next";
import {
  api,
  ApiError,
  type User,
  type Book,
  type Invitation,
  type ReceivedBookShare,
  type LedgerRecord,
  type RecordPage,
  type Analysis,
  type RecordOptions,
  type RecordOptionKind,
  type RecordAuthor,
} from "./api";
import {
  money,
  toCents,
  shanghaiDay,
  isoShanghai,
  nextDayISO,
  recordDate,
  categoryColor,
  canManage,
  canEdit,
} from "./utils";
import Modal from "./components/Modal.vue";
import TrendChart from "./components/TrendChart.vue";
import SelectInput from "./components/SelectInput.vue";
import OptionIcon from "./components/OptionIcon.vue";
import { useSmsCode } from "./useSmsCode";
import ThemePicker from "./components/ThemePicker.vue";
import { applyTheme, readStoredTheme, storeTheme, type ThemeId } from "./theme";
import { type OptionIconKind } from "./optionIcons";
import BookSwitcher from "./components/BookSwitcher.vue";
import DataTransfer from "./components/DataTransfer.vue";
import ShareBookDialog from "./components/ShareBookDialog.vue";
import OptionManager from "./components/OptionManager.vue";
const shareDialogBookId = ref("");
const transferMode = ref<"" | "import" | "export">("");
async function importedRecords(id: string, count: number) {
  if (id !== bookId.value) return;
  await Promise.all([loadRecords(), loadAnalysis()]);
  toast(`已追加导入${count}笔记录，原有记录保持不变`);
}
const user = ref<User | null>(null),
  booting = ref(true),
  bootError = ref(""),
  busy = ref(false),
  authMode = ref<"login" | "register">("login");
const auth = ref({ phone: "", password: "", name: "" }),
  authError = ref("");
const books = ref<Book[]>([]),
  invitations = ref<Invitation[]>([]),
  receivedShares = ref<ReceivedBookShare[]>([]),
  bookId = ref(""),
  view = ref("overview"),
  mobileMenu = ref(false);
const activeBook = computed(() =>
  books.value.find((b) => b.id === bookId.value),
);
const isOwner = computed(() =>
  canManage(activeBook.value, user.value?.id || ""),
);
const readOnlyBook = computed(() => activeBook.value?.readOnly === true);
const isFamilyBook = computed(() => activeBook.value?.type === "family");
const displayMemberName = (id: string, name: string) =>
  id === user.value?.id ? "我" : name;
const inboxCount = computed(
  () => invitations.value.length + receivedShares.value.length,
);
const shareDialogBook = computed(() =>
  books.value.find((b) => b.id === shareDialogBookId.value),
);
const inviteError = ref("");
const canInviteMembers = computed(
  () =>
    activeBook.value?.type === "family" &&
    isOwner.value &&
    !readOnlyBook.value,
);
async function openInvite() {
  if (!canInviteMembers.value) return;
  inviteError.value = "";
  navigate("members");
  await nextTick();
  const field = document.querySelector<HTMLInputElement>(".invite-form input");
  field?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  field?.focus({ preventScroll: true });
}
const records = ref<RecordPage>({ items: [], total: 0, page: 1, pageSize: 20 }),
  analysis = ref<Analysis | null>(null),
  authors = ref<RecordAuthor[]>([]),
  memberFilter = ref(""),
  lastRecordedDay = ref(""),
  analysisScope = ref<"book" | "all">("book");
const loadingRecords = ref(false),
  loadingAnalysis = ref(false),
  recordsError = ref(""),
  analysisError = ref("");
const period = ref("month"),
  analysisDate = ref(shanghaiDay()),
  page = ref(1);
const filter = ref({
    type: "",
    category: "",
    subcategory: "",
    q: "",
    from: "",
    to: "",
  }),
  appliedFilter = ref({ ...filter.value });
const members = ref<User[]>([]),
  membersLoading = ref(false),
  membersError = ref(""),
  invitePhone = ref("");
const modal = ref<"" | "book" | "record" | "confirm">(""),
  bookEditing = ref(false),
  bookForm = ref({ name: "", type: "personal" });
const editingRecord = ref<LedgerRecord | null>(null);
const recordForm = ref({
  type: "expense",
  amount: "",
  category: "餐饮美食",
  subcategory: "",
  occurredAt: shanghaiDay(),
  note: "",
  paymentSource: "微信",
});

const formError = ref(""),
  confirmation = ref({
    title: "",
    message: "",
    label: "确认",
    danger: false,
    action: async () => {},
  });
const security = ref({ currentPassword: "", newPassword: "", phone: "" });
const confirmPassword = ref("");
const resetting = ref(false);
const resetForm = ref({ phone: "", password: "", confirmation: "" });
const { challenge: resetChallenge, answer: resetAnswer, code: resetCode, error: resetError, seconds: resetSeconds, sending: resetSending, send: sendResetSms, reset: clearResetSms } = useSmsCode(() => resetForm.value.phone, "reset_password", body => api<{ retryAfter: number }>("/auth/sms/send", "POST", body), body => api<{ challengeId: string; image: string }>("/auth/sms/challenge", "POST", body));
function toggleReset(open: boolean) {
  authError.value = "";
  clearResetSms();
  resetForm.value = { phone: open ? auth.value.phone : "", password: "", confirmation: "" };
  resetting.value = open;
}
async function submitReset() {
  authError.value = "";
  const { phone, password, confirmation } = resetForm.value;
  if (password !== confirmation) {
    authError.value = "两次输入的密码不一致";
    return;
  }
  await mutate(async () => {
    try {
      await api("/auth/password/reset", "POST", { phone, newPassword: password, smsCode: resetCode.value });
      auth.value.phone = phone;
      auth.value.password = "";
      toggleReset(false);
      toast("密码已重置，请使用新密码登录");
    } catch (error) {
      authError.value = error instanceof Error ? error.message : "重置密码失败，请重试";
    }
  });
}

const { challenge: registerChallenge, answer: registerAnswer, code: registerSmsCode, error: registerSmsError, seconds: registerSmsSeconds, sending: registerSmsSending, send: sendRegisterSms, reset: resetRegisterSms } = useSmsCode(() => auth.value.phone, "register", body => api<{ retryAfter: number }>("/auth/sms/send", "POST", body), body => api<{ challengeId: string; image: string }>("/auth/sms/challenge", "POST", body));
const { challenge: changeChallenge, answer: changeAnswer, code: changeSmsCode, error: changeSmsError, seconds: changeSmsSeconds, sending: changeSmsSending, send: sendChangeSms } = useSmsCode(() => security.value.phone, "phone_change", body => api<{ retryAfter: number }>("/auth/sms/send", "POST", body), body => api<{ challengeId: string; image: string }>("/auth/sms/challenge", "POST", body));

const toasts = ref<{ id: number; message: string; error: boolean }[]>([]);
const theme = ref<ThemeId>(readStoredTheme()),
  themeSaving = ref(false);
function useTheme(next: unknown) {
  const applied = applyTheme(next);
  theme.value = applied;
  storeTheme(applied);
  return applied;
}
async function chooseTheme(next: ThemeId) {
  if (themeSaving.value || next === theme.value) return;
  const previous = theme.value;
  useTheme(next);
  const account = user.value;
  if (!account) return;
  themeSaving.value = true;
  try {
    const updated = await api<User>("/auth/settings", "PATCH", { theme: next });
    if (user.value?.id === account.id) user.value = updated;
    if (theme.value === next) useTheme(updated.theme ?? next);
    toast("界面色调已保存到账号");
  } catch (error) {
    if (theme.value === next) useTheme(previous);
    toast(`未能同步到账号：${failure(error)}`, true);
  } finally {
    themeSaving.value = false;
  }
}
let toastId = 0,
  recordRequest = 0,
  analysisRequest = 0,
  membersRequest = 0;
const recordOptions = ref<RecordOptions>({
  expenseCategories: [],
  incomeCategories: [],
  paymentSources: [],
  expenseSubcategories: {},
  incomeSubcategories: {},
  customExpenseSubcategories: {},
  customIncomeSubcategories: {},
});
const paymentSources = computed(() => recordOptions.value.paymentSources);
function subcategoryListFor(category: string, type: string) {
  const map =
    type === "income"
      ? recordOptions.value.incomeSubcategories
      : recordOptions.value.expenseSubcategories;
  return map &&
    Object.prototype.hasOwnProperty.call(map, category) &&
    Array.isArray(map[category])
    ? map[category]
    : [];
}
const subcategoryOptions = computed(() =>
  subcategoryListFor(recordForm.value.category, recordForm.value.type),
);
watch(subcategoryOptions, (options) => {
  if (!recordForm.value.subcategory && options.length)
    recordForm.value.subcategory = options[0];
});

const filterSubcategoryOptions = computed(() => {
  const maps = [
    recordOptions.value.expenseSubcategories,
    recordOptions.value.incomeSubcategories,
  ];
  const category = filter.value.category.trim();
  const names = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    if (category) {
      if (Object.prototype.hasOwnProperty.call(map, category))
        for (const name of map[category] ?? []) names.add(name);
    } else {
      for (const list of Object.values(map))
        for (const name of list) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
});
const expenseCategories = computed(() => recordOptions.value.expenseCategories);
const incomeCategories = computed(() => recordOptions.value.incomeCategories);

function recordIcon(kind: OptionIconKind, name: string) {
  const key: RecordOptionKind =
    kind === "payment"
      ? "paymentSource"
      : kind === "income"
        ? "incomeCategory"
        : "expenseCategory";
  const mapping = recordOptions.value.icons?.[key];
  const value = typeof name === "string" ? name.trim() : "";
  return mapping && Object.prototype.hasOwnProperty.call(mapping, value)
    ? mapping[value]
    : undefined;
}

let optionsRequest = 0;
const optionsLoading = ref(false);
function clearRecordOptions() {
  optionsLoading.value = false;
  ++optionsRequest;
  recordOptions.value = {
    expenseCategories: [],
    incomeCategories: [],
    paymentSources: [],
    expenseSubcategories: {},
    incomeSubcategories: {},
    customExpenseSubcategories: {},
    customIncomeSubcategories: {},
  };
}
async function loadRecordOptions() {
  const sequence = ++optionsRequest;
  const uid = user.value?.id;
  optionsLoading.value = true;
  try {
    const options = await api<RecordOptions>("/record-options");
    if (
      !options ||
      ![
        options.expenseCategories,
        options.incomeCategories,
        options.paymentSources,
      ].every(
        (values) =>
          Array.isArray(values) &&
          values.every((value) => typeof value === "string"),
      )
    )
      throw new Error("记账选项返回格式异常");
    if (sequence === optionsRequest && uid === user.value?.id)
      recordOptions.value = options;
  } finally {
    if (sequence === optionsRequest) optionsLoading.value = false;
  }
}
function setRecordCategory(value: string) {
  if (value === recordForm.value.category) return;
  recordForm.value.category = value;
  recordForm.value.subcategory =
    subcategoryListFor(value, recordForm.value.type)[0] ?? "";
}
function setRecordType(type: string) {
  recordForm.value.type = type;
  recordForm.value.category = type === "income" ? "工资薪酬" : "餐饮美食";
  recordForm.value.subcategory =
    subcategoryListFor(recordForm.value.category, type)[0] ?? "";
}
function toast(message: string, error = false) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, message, error }].slice(-3);
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 6000);
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "操作失败，请重试";
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code === "UNAUTHORIZED"
  ) {
    user.value = null;
    clearRecordOptions();
    books.value = [];
    receivedShares.value = [];
    bookId.value = "";
    modal.value = "";
    transferMode.value = "";
    toast("登录已过期，请重新登录", true);
  }
  return message;
}
async function mutate(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  formError.value = "";
  try {
    await action();
  } catch (error) {
    formError.value = failure(error);
    toast(formError.value, true);
  } finally {
    busy.value = false;
  }
}
async function loadBooks() {
  const data = await api<Book[]>("/books");
  books.value = data;
  if (!data.some((b) => b.id === bookId.value))
    bookId.value = data[0]?.id || "";
}
const sortingBooks = ref(false);
async function saveBookOrder(bookIds: string[]) {
  if (sortingBooks.value || busy.value) return;
  const previous = books.value;
  const byId = new Map(previous.map((book) => [book.id, book]));
  if (
    bookIds.length !== previous.length ||
    new Set(bookIds).size !== previous.length ||
    bookIds.some((id) => !byId.has(id))
  )
    return;
  sortingBooks.value = true;
  books.value = bookIds.map((id) => byId.get(id)!);
  try {
    books.value = await api<Book[]>("/books/order", "PATCH", { bookIds });
  } catch (error) {
    books.value = previous;
    toast(failure(error), true);
    if (error instanceof ApiError && error.status === 409) {
      try {
        await loadBooks();
      } catch (refreshError) {
        toast(failure(refreshError), true);
      }
    }
  } finally {
    sortingBooks.value = false;
  }
}
async function loadInvitations() {
  invitations.value = await api<Invitation[]>("/invitations");
}
async function loadReceivedShares() {
  receivedShares.value = await api<ReceivedBookShare[]>("/shares");
}
async function refreshInbox() {
  await Promise.all([loadInvitations(), loadReceivedShares()]);
}
async function processShare(share: ReceivedBookShare, accept: boolean) {
  await api(`/shares/${share.id}/${accept ? "accept" : "reject"}`, "POST");
  await Promise.all([loadReceivedShares(), loadInvitations(), loadBooks()]);
  if (accept) {
    bookId.value = share.bookId;
    navigate("overview");
  }
  toast(accept ? "已接受只读分享，账本已加入列表" : "已拒绝分享");
}
async function respondShare(share: ReceivedBookShare, accept: boolean) {
  await mutate(() => processShare(share, accept));
}
async function initialize() {
  booting.value = true;
  bootError.value = "";
  try {
    user.value = await api<User>("/auth/me");
    useTheme(user.value.theme ?? readStoredTheme());
    await Promise.all([loadBooks(), refreshInbox(), loadRecordOptions()]);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401))
      bootError.value = failure(error);
  } finally {
    booting.value = false;
  }
}
async function submitAuth() {
  if (authMode.value === "register" && auth.value.password !== confirmPassword.value) {
    authError.value = "两次输入的密码不一致";
    return;
  }
  authError.value = "";
  await mutate(async () => {
    try {
      const signedIn = await api<User>(
        `/auth/${authMode.value}`,
        "POST",
        authMode.value === "register"
          ? { ...auth.value, smsCode: registerSmsCode.value }
          : { phone: auth.value.phone, password: auth.value.password },
      );
      resetRegisterSms();
      confirmPassword.value = "";
      user.value = signedIn;
      useTheme(signedIn.theme ?? readStoredTheme());
      clearRecordOptions();
      await Promise.all([loadBooks(), refreshInbox(), loadRecordOptions()]);
      toast(
        authMode.value === "login"
          ? "欢迎回来，生活的每一笔都值得记录"
          : "注册成功，开启你的第一本账吧",
      );
      auth.value.password = "";
    } catch (error) {
      authError.value = failure(error);
      throw error;
    }
  });
}
async function loadRecords() {
  const id = bookId.value,
    sequence = ++recordRequest;
  if (!id) {
    records.value = { items: [], total: 0, page: 1, pageSize: 20 };
    loadingRecords.value = false;
    return;
  }
  loadingRecords.value = true;
  recordsError.value = "";
  try {
    const f = appliedFilter.value;
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: "20",
    });
    for (const key of ["type", "category", "subcategory", "q"] as const)
      if (f[key]) params.set(key, f[key]);
    if (f.from) params.set("from", isoShanghai(f.from));
    if (f.to) params.set("to", nextDayISO(f.to));
    if (memberFilter.value) params.set("createdBy", memberFilter.value);
    const result = await api<RecordPage>(`/books/${id}/records?${params}`);
    if (sequence === recordRequest) {
      records.value = result;
      authors.value = result.authors ?? [];
      if (
        !lastRecordedDay.value &&
        page.value === 1 &&
        !Object.values(appliedFilter.value).some(Boolean) &&
        result.items[0]
      )
        lastRecordedDay.value = shanghaiDay(
          new Date(result.items[0].occurredAt),
        );
    }
  } catch (error) {
    if (sequence === recordRequest) recordsError.value = failure(error);
  } finally {
    if (sequence === recordRequest) loadingRecords.value = false;
  }
}
async function loadAnalysis() {
  const id = bookId.value,
    sequence = ++analysisRequest;
  if (!id) {
    analysis.value = null;
    loadingAnalysis.value = false;
    return;
  }
  loadingAnalysis.value = true;
  analysisError.value = "";
  try {
    const params = new URLSearchParams({
      period: period.value,
      date: analysisDate.value,
    });
    const allBooks = analysisScope.value === "all";
    if (!allBooks && memberFilter.value)
      params.set("member", memberFilter.value);
    const result = await api<Analysis>(
      allBooks
        ? `/analysis?${params}`
        : `/books/${id}/analysis?${params}`,
    );
    if (sequence === analysisRequest) analysis.value = result;
  } catch (error) {
    if (sequence === analysisRequest) analysisError.value = failure(error);
  } finally {
    if (sequence === analysisRequest) loadingAnalysis.value = false;
  }
}
async function loadMembers() {
  const id = bookId.value,
    sequence = ++membersRequest;
  if (!id || readOnlyBook.value) {
    members.value = [];
    membersError.value = "";
    membersLoading.value = false;
    return;
  }
  membersLoading.value = true;
  membersError.value = "";
  try {
    const result = await api<{ ownerId: string; members: User[] }>(
      `/books/${id}/members`,
    );
    if (sequence === membersRequest) members.value = result.members;
  } catch (error) {
    if (sequence === membersRequest) membersError.value = failure(error);
  } finally {
    if (sequence === membersRequest) membersLoading.value = false;
  }
}
function setAnalysisScope(scope: "book" | "all") {
  if (scope === analysisScope.value) return;
  analysisScope.value = scope;
  if (scope === "all" && memberFilter.value) {
    memberFilter.value = "";
    if (page.value === 1) void loadRecords();
    else page.value = 1;
  }
  void loadAnalysis();
}
function setMemberFilter(value: string) {
  if (value === memberFilter.value) return;
  memberFilter.value = value;
  if (page.value === 1) void loadRecords();
  else page.value = 1;
  void loadAnalysis();
}
function navigate(target: string) {
  const leavingAll =
    target !== "analysis" && analysisScope.value === "all";
  view.value = target;
  mobileMenu.value = false;
  if (leavingAll) {
    analysisScope.value = "book";
    void loadAnalysis();
  }
  if (target === "members") void loadMembers();
  if (target === "options")
    void loadRecordOptions().catch((e) => toast(failure(e), true));
  if (target === "invitations")
    void refreshInbox().catch((e) => toast(failure(e), true));
}
watch(bookId, () => {
  invitePhone.value = "";
  inviteError.value = "";
  page.value = 1;
  members.value = [];
  authors.value = [];
  memberFilter.value = "";
  lastRecordedDay.value = "";
  analysisScope.value = "book";
  analysis.value = null;
  records.value = { items: [], total: 0, page: 1, pageSize: 20 };
  void loadRecords();
  void loadAnalysis();
  if (view.value === "members") void loadMembers();
});
watch(page, loadRecords);
watch([period, analysisDate], () => {
  if (analysisDate.value) void loadAnalysis();
});
function applyFilters() {
  if (
    filter.value.from &&
    filter.value.to &&
    filter.value.from > filter.value.to
  ) {
    toast("开始日期不能晚于结束日期", true);
    return;
  }
  appliedFilter.value = { ...filter.value };
  if (page.value === 1) void loadRecords();
  else page.value = 1;
}
function resetFilters() {
  filter.value = {
    type: "",
    category: "",
    subcategory: "",
    q: "",
    from: "",
    to: "",
  };
  applyFilters();
}
function newBook(edit = false) {
  bookEditing.value = edit;
  bookForm.value = {
    name: edit ? activeBook.value?.name || "" : "",
    type: edit ? activeBook.value?.type || "personal" : "personal",
  };
  formError.value = "";
  modal.value = "book";
}
async function saveBook() {
  await mutate(async () => {
    const result = await api<Book>(
      bookEditing.value ? `/books/${bookId.value}` : "/books",
      bookEditing.value ? "PATCH" : "POST",
      bookEditing.value
        ? { name: bookForm.value.name.trim() }
        : { ...bookForm.value, name: bookForm.value.name.trim() },
    );
    await loadBooks();
    bookId.value = result.id;
    modal.value = "";
    toast(bookEditing.value ? "账本名称已更新" : "新账本创建成功");
  });
}
function defaultRecordDay() {
  return lastRecordedDay.value || shanghaiDay();
}
function openRecord(record?: LedgerRecord) {
  if (readOnlyBook.value) return;
  void loadRecordOptions().catch((error) => toast(failure(error), true));
  editingRecord.value = record || null;
  recordForm.value = record
    ? {
        type: record.type,
        amount: (record.amountCents / 100).toFixed(2),
        category: record.category,
        subcategory:
          record.subcategory ||
          subcategoryListFor(record.category, record.type)[0] ||
          "",
        occurredAt: shanghaiDay(new Date(record.occurredAt)),
        note: record.note,
        paymentSource: record.paymentSource,
      }
    : {
        type: "expense",
        amount: "",
        category: "餐饮美食",
        subcategory: subcategoryListFor("餐饮美食", "expense")[0] || "",
        occurredAt: defaultRecordDay(),
        note: "",
        paymentSource: "微信",
      };
  formError.value = "";
  modal.value = "record";
}
async function saveRecord() {
  if (readOnlyBook.value) return;
  if (!recordForm.value.subcategory.trim()) {
    formError.value = "请选择或添加小分类";
    return;
  }
  await mutate(async () => {
    const previous = editingRecord.value;
    const day = recordForm.value.occurredAt;
    const data = {
      ...recordForm.value,
      amountCents: toCents(recordForm.value.amount),
      occurredAt: previous && shanghaiDay(new Date(previous.occurredAt)) === day
         ? previous.occurredAt
         : isoShanghai(day),
    };
    await api(
      `/books/${bookId.value}/records${editingRecord.value ? "/" + editingRecord.value.id : ""}`,
      editingRecord.value ? "PATCH" : "POST",
      {
        type: data.type,
        amountCents: data.amountCents,
        category: data.category.trim(),
        subcategory: data.subcategory.trim(),
        occurredAt: data.occurredAt,
        note: data.note.trim(),
        paymentSource: data.paymentSource.trim(),
      },
    );
    lastRecordedDay.value = day;
    modal.value = "";
    toast(editingRecord.value ? "记录已更新" : "这一笔，记好了");
    await Promise.all([loadRecords(), loadAnalysis()]);
  });
}
function confirm(
  title: string,
  message: string,
  action: () => Promise<void>,
  label = "确认",
  danger = true,
) {
  confirmation.value = { title, message, action, label, danger };
  formError.value = "";
  modal.value = "confirm";
}
async function performConfirmation() {
  await mutate(async () => {
    await confirmation.value.action();
    modal.value = "";
  });
}
function removeRecord(record: LedgerRecord) {
  confirm(
    "删除这笔记录？",
    `${record.category}${record.subcategory ? " / " + record.subcategory : ""} · ¥${money(record.amountCents)}。删除后无法恢复。`,
    async () => {
      await api(`/books/${bookId.value}/records/${record.id}`, "DELETE");
      if (records.value.items.length === 1 && page.value > 1) page.value--;
      await Promise.all([loadRecords(), loadAnalysis()]);
      toast("记录已删除");
    },
    "删除记录",
  );
}
function deleteBook() {
  const book = activeBook.value;
  if (!book) return;
  confirm(
    "删除账本？",
    `「${book.name}」中的所有记录和待接受邀请也将永久删除，请谨慎操作。`,
    async () => {
      await api(`/books/${book.id}`, "DELETE");
      await loadBooks();
      toast("账本已删除");
    },
    "永久删除",
  );
}
function removeMember(member: User) {
  const self = member.id === user.value?.id;
  confirm(
    self ? "退出家庭账本？" : "移除家庭成员？",
    self
      ? "退出后将无法查看此账本，你创建的记录会保留。"
      : `移除 ${member.name} 后，对方将无法查看或新增记录。`,
    async () => {
      await api(`/books/${bookId.value}/members/${member.id}`, "DELETE");
      await loadBooks();
      if (self) navigate("overview");
      else await loadMembers();
      toast(self ? "已退出账本" : "成员已移除");
    },
    self ? "退出账本" : "移除成员",
  );
}
async function sendInvite() {
  inviteError.value = "";
  await mutate(async () => {
    try {
      await api(`/books/${bookId.value}/invitations`, "POST", {
        phone: invitePhone.value,
      });
    } catch (error) {
      inviteError.value =
        error instanceof Error ? error.message : "邀请发送失败，请重试";
      throw error;
    }
    invitePhone.value = "";
    toast("邀请已发送，对方登录后可在平台内接受");
  });
}
async function processInvite(invite: Invitation, accept: boolean) {
  await api(
    `/invitations/${invite.id}/${accept ? "accept" : "reject"}`,
    "POST",
  );
  await Promise.all([loadInvitations(), loadBooks()]);
  if (accept) {
    bookId.value = invite.bookId;
    navigate("overview");
  }
  toast(accept ? "已加入家庭账本" : "已拒绝邀请");
}
async function respondInvite(invite: Invitation, accept: boolean) {
  await mutate(() => processInvite(invite, accept));
}
async function updateSecurity(kind: "phone" | "password") {
  await mutate(async () => {
    if (kind === "phone")
      user.value = await api<User>("/auth/phone", "PATCH", {
        phone: security.value.phone,
        smsCode: changeSmsCode.value,
        currentPassword: security.value.currentPassword,
      });
    else
      await api("/auth/password", "PATCH", {
        currentPassword: security.value.currentPassword,
        newPassword: security.value.newPassword,
      });
    security.value = { currentPassword: "", newPassword: "", phone: "" };
    if (kind === "phone") await loadInvitations();
    toast(kind === "phone" ? "手机号已更新" : "密码已更新，其他设备已退出登录");
  });
}
function logout() {
  confirm(
    "退出登录？",
    "当前设备将退出，小家的账目会被妥善保存。",
    async () => {
      await api("/auth/logout", "POST");
      user.value = null;
      clearRecordOptions();
      books.value = [];
      receivedShares.value = [];
      bookId.value = "";
      view.value = "overview";
      toast("已安全退出");
    },
    "退出登录",
    false,
  );
}
onMounted(initialize);
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="{ error: t.error }"
      role="status"
    >
      <component :is="t.error ? CircleHelp : Check" :size="18" /><span>{{
        t.message
      }}</span
      ><button
        aria-label="关闭通知"
        @click="toasts = toasts.filter((item) => item.id !== t.id)"
      >
        <X :size="16" />
      </button>
    </div>
  </div>
  <div v-if="booting" class="boot-state">
    <div class="brand-mark"><Leaf :size="28" /></div>
    <span class="spinner" />
    <p>正在打开你的小家账本…</p>
  </div>
  <div v-else-if="bootError" class="boot-state">
    <CircleHelp :size="36" />
    <h2>暂时无法连接小家</h2>
    <p>{{ bootError }}</p>
    <button class="primary" @click="initialize">重新连接</button>
  </div>
  <div v-else-if="!user" class="auth-layout">
    <section class="auth-story">
      <a class="brand"
        ><span class="brand-mark"><Leaf :size="26" /></span
        ><span>小家有账<small>NESTLEDGER</small></span></a
      >
      <div class="story-copy">
        <span class="eyebrow">把日子过成喜欢的样子</span>
        <h1>每一笔生活，<br />都值得好好记住。</h1>
        <p>从一杯咖啡，到一个家的未来。<br />让收支更清晰，让生活更从容。</p>
        <div class="story-art" aria-hidden="true">
          <div class="art-roof"></div>
          <div class="art-house">
            <Leaf :size="54" /><span>小家的日常</span>
            <div class="art-line"></div>
            <div class="art-line short"></div>
          </div>
          <span class="art-plant">✳</span><span class="art-sun"></span>
          <div class="art-card"><Check :size="18" /> 把美好，一笔笔攒起来</div>
        </div>
      </div>
      <p class="story-footer">个人记账 · 家庭共享 · 看见生活</p>
    </section>
    <main class="auth-main">
      <div class="auth-box">
        <span class="eyebrow">WELCOME HOME</span>
        <h2>
          {{ authMode === "login" ? "欢迎回到小家" : "开启你的小家账本" }}
        </h2>
        <p class="muted">
          {{
            authMode === "login"
              ? "登录后，接着记录生活的点滴。"
              : "注册账号，让每一笔收支都有归处。"
          }}
        </p>
        <div v-if="!resetting" class="segmented auth-tabs">
          <button
            :class="{ active: authMode === 'login' }"
            @click="
              authMode = 'login';
              authError = '';
            "
          >
            登录</button
          ><button
            :class="{ active: authMode === 'register' }"
            @click="
              authMode = 'register';
              authError = '';
            "
          >
            注册
          </button>
        </div>
        <form v-if="resetting" @submit.prevent="submitReset">
          <h3>重置密码</h3>
          <p class="muted">验证账号绑定的手机号后，即可设置新密码。</p>
          <label>手机号<input v-model="resetForm.phone" type="tel" autocomplete="tel" pattern="1[3-9][0-9]{9}" maxlength="11" required /></label>
          <div v-if="resetChallenge" class="sms-field">
            <img :src="resetChallenge.image" width="150" height="48" alt="短信发送前的图形验证码" />
            <button type="button" class="secondary" :disabled="resetSending || busy" @click="sendResetSms(true)">换一张</button>
            <label>图形验证码<input v-model="resetAnswer" autocomplete="off" maxlength="5" /></label>
          </div>
          <div class="sms-field">
            <button type="button" class="secondary" :disabled="resetSending || resetSeconds > 0 || !/^1[3-9][0-9]{9}$/.test(resetForm.phone) || busy" @click="sendResetSms()">
              {{ resetSending ? "发送中…" : resetSeconds ? `${resetSeconds} 秒后重发` : resetChallenge ? "验证并发送短信" : "获取验证码" }}
            </button>
            <p v-if="resetError" class="form-error" role="alert">{{ resetError }}</p>
          </div>
          <label>短信验证码<input v-model="resetCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
          <label>新密码<input v-model="resetForm.password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required /></label>
          <label>确认新密码<input v-model="resetForm.confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="72" required /></label>
          <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
          <button class="primary wide auth-submit" :disabled="busy">{{ busy ? "正在重置…" : "重置密码" }}</button>
          <button type="button" class="text-button" :disabled="busy" @click="toggleReset(false)">返回登录</button>
        </form>
        <form v-else @submit.prevent="submitAuth">
          <label v-if="authMode === 'register'"
            >你的称呼<input
              v-model="auth.name"
              placeholder="大家怎么称呼你"
              maxlength="40"
              required
              autocomplete="nickname" /></label
          ><label
            >手机号<input
              v-model="auth.phone"
              type="tel"
              inputmode="tel"
              placeholder="请输入 11 位手机号"
              pattern="1[3-9][0-9]{9}"
              maxlength="11"
              required
              autocomplete="tel" /></label
          ><label
            >密码<input
              v-model="auth.password"
              type="password"
              :placeholder="
                authMode === 'register' ? '设置 8–72 位密码' : '请输入密码'
              "
              minlength="8"
              maxlength="72"
              required
              :autocomplete="
                authMode === 'login' ? 'current-password' : 'new-password'
              "
          /></label>
          <label v-if="authMode === 'register'">确认密码<input v-model="confirmPassword" type="password" autocomplete="new-password" required maxlength="72" /></label>
          <div v-if="authMode === 'register'" class="sms-field">
              <label>短信验证码<input v-model="registerSmsCode" inputmode="numeric" autocomplete="one-time-code" placeholder="请输入 6 位验证码" pattern="[0-9]{6}" maxlength="6" required /></label>
              <button type="button" class="secondary" :disabled="registerSmsSending || registerSmsSeconds > 0 || !/^1[3-9][0-9]{9}$/.test(auth.phone) || busy" @click="sendRegisterSms()">
                {{ registerSmsSending ? "发送中…" : registerSmsSeconds ? `${registerSmsSeconds} 秒后重发` : registerChallenge ? "验证并发送短信" : "获取验证码" }}
              </button>
              <div v-if="registerChallenge" class="sms-field">
                <img :src="registerChallenge.image" width="150" height="48" alt="短信发送前的图形验证码" />
                <button type="button" class="secondary" :disabled="registerSmsSending" @click="sendRegisterSms(true)">换一张</button>
                <label>图形验证码<input v-model="registerAnswer" autocomplete="off" maxlength="5" placeholder="输入五位字母或数字" /></label>
              </div>
              <p v-if="registerSmsError" class="form-error" role="alert">{{ registerSmsError }}</p>
            </div>
            <p v-if="authError" class="form-error" role="alert">
            {{ authError }}
          </p>
          <button class="primary wide auth-submit" :disabled="busy">
            {{
              busy
                ? "请稍候…"
                : authMode === "login"
                  ? "登录小家"
                  : "注册并开启记账"
            }}<ChevronRight :size="18" />
          </button>
        </form>
        <button v-if="!resetting && authMode === 'login'" type="button" class="text-button" @click="toggleReset(true)">忘记密码？</button>
        <p class="auth-note">
          <Leaf :size="16" /> 安心记账，只有受邀家人能看到家庭账本
        </p>
        <p class="tiny muted">
          注册需验证手机号；家庭邀请仍在站内发送。
        </p>
      </div>
      <footer>小家有账 NestLedger · 为生活留一份底气</footer>
    </main>
  </div>
  <div v-else class="app-shell">
    <div
      v-if="mobileMenu"
      class="sidebar-overlay"
      @click="mobileMenu = false"
    ></div>
    <aside class="sidebar" :class="{ open: mobileMenu }">
      <a class="brand" href="#" @click.prevent="navigate('overview')"
        ><span class="brand-mark"><Leaf :size="26" /></span
        ><span>小家有账<small>NESTLEDGER</small></span></a
      ><button
        class="mobile-close icon-button"
        aria-label="关闭导航"
        @click="mobileMenu = false"
      >
        <X />
      </button>
      <div class="book-selector">
        <BookSwitcher
          v-model="bookId"
          :books="books"
          :saving="sortingBooks || busy"
          @reorder="saveBookOrder"
        />
        <button class="text-button" @click="newBook()">
          <Plus :size="15" /> 新建账本
        </button>
      </div>
      <div class="nav-caption">我的小家</div>
      <nav aria-label="主导航">
        <button
          :class="{ active: view === 'overview' }"
          @click="navigate('overview')"
        >
          <Home :size="19" /> 账本概览</button
        ><button
          :class="{ active: view === 'records' }"
          @click="navigate('records')"
        >
          <Wallet :size="19" /> 收支明细</button
        ><button
          :class="{ active: view === 'analysis' }"
          @click="navigate('analysis')"
        >
          <TrendingUp :size="19" /> 收支分析</button
        ><button
          :class="{ active: view === 'members' }"
          @click="navigate('members')"
        >
          <Users :size="19" /> 账本管理</button
        ><button
          :class="{ active: view === 'options' }"
          @click="navigate('options')"
        >
          <Tags :size="19" /> 分类与支付方式</button
        ><button
          :class="{ active: view === 'invitations' }"
          title="账号收到的家庭邀请和账本分享，与当前选择的账本无关"
          @click="navigate('invitations')"
        >
          <Bell :size="19" /> 我的邀请<span
            v-if="inboxCount"
            class="badge"
            >{{ inboxCount }}</span
          >
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-tip">
          <Leaf :size="21" />
          <p>
            好好记账，好好生活。<br /><small>小改变，也能积攒大安心。</small>
          </p>
        </div>
        <button class="profile" @click="navigate('account')">
          <span class="avatar">{{ user.name.slice(0, 1) }}</span><span
            ><strong>{{ user.name }}</strong
            ><small>账户与安全</small></span
          ><Settings :size="17" /></button
        ><button class="logout text-button" @click="logout">
          <LogOut :size="16" /> 退出登录
        </button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="breadcrumb">
          <button
            class="icon-button mobile-menu"
            aria-label="打开导航"
            @click="mobileMenu = true"
          >
            <Menu :size="22" /></button
          ><span>我的小家</span><ChevronRight :size="14" /><strong>{{
            {
              overview: "账本概览",
              records: "收支明细",
              analysis: "收支分析",
              members: "账本管理",
              options: "分类与支付方式",
              invitations: "我的邀请",
              account: "账户与安全",
            }[view as "overview"]
          }}</strong>
        </div>
        <div class="top-actions">
          <span class="today">{{
            shanghaiDay().replaceAll("-", ".")
          }}</span><button
            class="icon-button notification"
            aria-label="查看邀请"
            @click="navigate('invitations')"
          >
            <Bell :size="19" /><i v-if="inboxCount"></i></button
          ><span class="avatar small">{{ user.name.slice(0, 1) }}</span>
        </div>
      </header>
      <div class="page-content">
        <template v-if="['overview', 'records', 'analysis'].includes(view)"
          ><div class="page-heading ledger-heading">
            <div>
              <span class="eyebrow">{{
                view === "overview"
                  ? "A LITTLE ORDER, A LOT OF PEACE"
                  : view === "records"
                    ? "EVERY LITTLE MOMENT COUNTS"
                    : "SEE YOUR LIFE MORE CLEARLY"
              }}</span>
              <h1>
                {{
                  view === "overview"
                    ? "生活有数，心里有底"
                    : view === "records"
                      ? "每一笔，都是生活"
                      : "看见收支，规划未来"
                }}<span v-if="view === 'overview'" class="heading-leaf"
                  ><Leaf :size="26"
                /></span>
              </h1>
              <p>
                {{
                  activeBook
                    ? `${activeBook.name} · ${activeBook.readOnly ? (activeBook.ownerPhone ? "来自 " + activeBook.ownerPhone + " 的只读账本" : "他人分享给你的只读账本") : activeBook.type === "family" ? "和家人一起，把日子记清楚" : "属于自己的生活账本"}`
                    : "创建第一本账本，从今天开始记录美好。"
                }}
              </p>
            </div>
            <div v-if="activeBook && !readOnlyBook" class="button-row">
              <button
                v-if="isOwner"
                class="secondary share-action"
                @click="shareDialogBookId = activeBook.id"
              >
                <Share2 :size="18" /> 分享账本
              </button>
              <button
                v-if="!readOnlyBook"
                class="secondary transfer-action"
                @click="transferMode = 'export'"
              >
                导出账本
              </button>
              <button
                v-if="!readOnlyBook"
                class="secondary transfer-action"
                @click="transferMode = 'import'"
              >
                导入账本
              </button>
              <button
                v-if="canInviteMembers"
                class="secondary invite-action"
                @click="openInvite"
              >
                <Users :size="18" /> 邀请家人
              </button>
              <button
                v-if="!readOnlyBook"
                class="primary record-action"
                @click="openRecord()"
              >
                <Plus :size="18" /> 记一笔
              </button>
            </div>
            <button
              v-else-if="!activeBook"
              class="primary"
              @click="newBook()"
            >
              <Plus :size="18" /> 新建账本
            </button>
          </div>
          <div v-if="readOnlyBook" class="info-note invitation-info" role="note">
            <CircleHelp :size="18" />
            <p>
              这是
              <strong>{{ activeBook?.ownerName || "对方" }}</strong
              ><template v-if="activeBook?.ownerPhone"
                >（{{ activeBook?.ownerPhone }}）</template
              >
              分享给你的<strong>只读账本</strong>。你可以查看全部记录和收支分析，但不能新增、修改、导入或导出。
            </p>
          </div>
          <div
            v-if="
              analysisScope === 'book' &&
              isFamilyBook &&
              activeBook &&
              authors.length > 1
            "
            class="member-filter-bar"
          >
            <label class="inline-label"
              >记录人<select
                :value="memberFilter"
                aria-label="按记录人筛选"
                @change="
                  setMemberFilter(
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">全部成员</option>
                <option
                  v-for="author in authors"
                  :key="author.id"
                  :value="author.id"
                >
                  {{ displayMemberName(author.id, author.name) }}
                </option>
              </select></label
            >
            <span class="period-hint">概览、明细和分析同步按成员筛选</span>
          </div>
          <div v-if="!activeBook" class="card empty-state large">
            <span class="empty-icon"><BookOpen :size="38" /></span>
            <h2>生活的新一页，从这里开始</h2>
            <p>
              创建个人账本，或者与家人共享一本家庭账本。<br />收入、支出和小目标，都有自己的位置。
            </p>
            <button class="primary" @click="newBook()">
              <Plus :size="18" /> 创建我的第一本账本</button
            ><button class="text-button" @click="navigate('invitations')">
              查看家庭邀请 <ChevronRight :size="16" />
            </button>
          </div>
          <template v-else>
            <template v-if="view !== 'records'"
              ><div class="period-toolbar">
                <div class="segmented" aria-label="分析周期">
                  <button
                    v-for="(label, key) in {
                      week: '周',
                      month: '月',
                      year: '年',
                    }"
                    :key="key"
                    :class="{ active: period === key }"
                    @click="period = key"
                  >
                    {{ label }}
                  </button>
                </div>
                <div
                  v-if="view === 'analysis'"
                  class="segmented"
                  aria-label="统计范围"
                >
                  <button
                    :class="{ active: analysisScope === 'book' }"
                    @click="setAnalysisScope('book')"
                  >
                    当前账本
                  </button>
                  <button
                    :class="{ active: analysisScope === 'all' }"
                    @click="setAnalysisScope('all')"
                  >
                    全部账本
                  </button>
                </div>
                <label class="inline-label"
                  >查看日期<input
                    v-model="analysisDate"
                    type="date"
                    aria-label="分析日期"
                    required /></label
                ><span class="period-hint"
                  >{{
                    analysisScope === "all"
                      ? "全部账本 · 仅统计我记录的收支 · "
                      : ""
                  }}以北京时间统计 · 自然{{
                    period === "week"
                      ? "周（周一开始）"
                      : period === "month"
                        ? "月"
                        : "年"
                  }}</span
                >
              </div>
              <div v-if="analysisError" class="error-banner" role="alert">
                {{ analysisError
                }}<button class="text-button" @click="loadAnalysis">
                  重新加载
                </button>
              </div>
              <div v-else-if="loadingAnalysis" class="loading-panel">
                <span class="spinner" /> 正在整理这一段生活…
              </div>
              <template v-else-if="analysis"
                ><div class="stats-grid">
                  <article class="stat-card income">
                    <div class="stat-label">
                      本{{
                        period === "week"
                          ? "周"
                          : period === "month"
                            ? "月"
                            : "年"
                      }}收入<span class="stat-icon income"
                        ><ArrowDownLeft :size="19"
                      /></span>
                    </div>
                    <strong class="income-text"
                      ><small>¥</small>
                      {{ money(analysis.incomeCents) }}</strong
                    ><span class="stat-foot">每一份努力，都有回响</span>
                  </article>
                  <article class="stat-card expense">
                    <div class="stat-label">
                      本{{
                        period === "week"
                          ? "周"
                          : period === "month"
                            ? "月"
                            : "年"
                      }}支出<span class="stat-icon expense"
                        ><ArrowUpRight :size="19"
                      /></span>
                    </div>
                    <strong
                      ><small>¥</small>
                      {{ money(analysis.expenseCents) }}</strong
                    ><span class="stat-foot">认真生活，也认真花钱</span>
                  </article>
                  <article class="stat-card balance">
                    <div class="stat-label">
                      本期结余<span class="stat-icon"
                        ><Wallet :size="19"
                      /></span>
                    </div>
                    <strong
                      ><small>¥</small>
                      {{ money(analysis.balanceCents) }}</strong
                    ><span class="stat-foot"
                      >收入 − 支出 · 共 {{ analysis.recordCount }} 笔记录</span
                    >
                  </article>
                </div>
                <div class="analysis-grid">
                  <section class="card trend-card">
                    <div class="section-head">
                      <div>
                        <h2>收支趋势</h2>
                        <p>生活的起伏，一目了然</p>
                      </div>
                      <div class="chart-legend">
                        <span><i class="green-dot"></i>收入</span
                        ><span><i class="orange-dot"></i>支出</span>
                      </div>
                    </div>
                    <TrendChart :points="analysis.trend" />
                    <p v-if="!analysis.recordCount" class="chart-empty-note">
                      {{
                        readOnlyBook
                          ? "这个周期还没有记录。"
                          : "这个周期还没有记录，记下第一笔吧。"
                      }}
                    </p>
                    <details class="chart-table">
                      <summary>查看趋势数据表</summary>
                      <table>
                        <thead>
                          <tr>
                            <th>日期</th>
                            <th>收入（元）</th>
                            <th>支出（元）</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="point in analysis.trend"
                            :key="point.label"
                          >
                            <td>{{ point.label }}</td>
                            <td>{{ money(point.incomeCents) }}</td>
                            <td>{{ money(point.expenseCents) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </details>
                  </section>
                  <section class="card categories-card">
                    <div class="section-head">
                      <div>
                        <h2>钱都花在哪里</h2>
                        <p>支出大分类 · 共 {{ analysis.categories.length }} 类</p>
                      </div>
                      <CreditCard :size="20" class="muted" />
                    </div>
                    <div
                      v-if="!analysis.categories.length"
                      class="empty-state compact"
                    >
                      <Leaf :size="30" />
                      <p>
                        本期暂无支出<br /><small
                          >小家的余额，还在慢慢积攒。</small
                        >
                      </p>
                    </div>
                    <div v-else class="category-list">
                      <div
                        v-for="c in analysis.categories"
                        :key="c.category"
                        class="category-item"
                      >
                        <div class="category-row">
                          <span class="category-label"
                            ><OptionIcon
                              kind="expense"
                              :name="c.category"
                              :icon="recordIcon('expense', c.category)"
                              :size="15"
                            />{{ c.category }}</span
                          ><strong>¥{{ money(c.amountCents) }}</strong>
                        </div>
                        <div class="category-track">
                          <span
                            :style="{
                              width:
                                (c.amountCents / analysis.expenseCents) * 100 +
                                '%',
                              background: categoryColor(c.category),
                            }"
                          ></span>
                        </div>
                        <div
                          v-if="c.subcategories?.length"
                          class="subcategory-list"
                        >
                          <span
                            v-for="sub in c.subcategories"
                            :key="sub.name"
                            >{{ sub.name }} ¥{{ money(sub.amountCents) }}</span
                          >
                        </div>
                        <small
                          >{{ c.count }} 笔 ·
                          {{
                            (
                              (c.amountCents / analysis.expenseCents) *
                              100
                            ).toFixed(1)
                          }}%</small
                        >
                      </div>
                    </div>
                  </section>
                </div>
                <section
                  v-if="
                    view === 'analysis' &&
                    analysisScope === 'all' &&
                    analysis.books?.length
                  "
                  class="card member-analysis-card"
                >
                  <div class="section-head">
                    <div>
                      <h2>各账本汇总</h2>
                      <p>仅统计由我记录的收支</p>
                    </div>
                    <BookOpen :size="21" class="muted" />
                  </div>
                  <div class="table-wrap">
                    <table class="records-table member-table book-summary-table">
                      <thead>
                        <tr>
                          <th>账本</th>
                          <th>收入</th>
                          <th>支出</th>
                          <th>结余</th>
                          <th>笔数</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="book in analysis.books"
                          :key="book.bookId"
                        >
                          <td>
                            <strong>{{ book.name }}</strong>
                          </td>
                          <td class="income-text">
                            +{{ money(book.incomeCents) }}
                          </td>
                          <td>−{{ money(book.expenseCents) }}</td>
                          <td>{{ money(book.balanceCents) }}</td>
                          <td>{{ book.recordCount }} 笔</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
                <section
                  v-if="
                    view === 'analysis' &&
                    analysisScope === 'book' &&
                    isFamilyBook &&
                    analysis.members.length
                  "
                  class="card member-analysis-card"
                >
                  <div class="section-head">
                    <div>
                      <h2>成员收支</h2>
                      <p>本周期每位家庭成员的记录与结余</p>
                    </div>
                    <Users :size="21" class="muted" />
                  </div>
                  <div class="table-wrap">
                    <table class="records-table member-table">
                      <thead>
                        <tr>
                          <th>成员</th>
                          <th>收入</th>
                          <th>支出</th>
                          <th>结余</th>
                          <th>笔数</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="member in analysis.members"
                          :key="member.userId"
                          :class="{
                            'member-row-active':
                              memberFilter === member.userId,
                          }"
                        >
                          <td>
                            <strong>{{
                              displayMemberName(member.userId, member.name)
                            }}</strong>
                          </td>
                          <td class="income-text">
                            +{{ money(member.incomeCents) }}
                          </td>
                          <td>−{{ money(member.expenseCents) }}</td>
                          <td>{{ money(member.balanceCents) }}</td>
                          <td>{{ member.recordCount }} 笔</td>
                          <td class="member-action">
                            <button
                              class="text-button"
                              @click="
                                setMemberFilter(
                                  memberFilter === member.userId
                                    ? ''
                                    : member.userId,
                                )
                              "
                            >
                              {{
                                memberFilter === member.userId
                                  ? "查看全部"
                                  : "只看该成员"
                              }}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </template
              ></template
            >
            <section
              v-if="view !== 'analysis'"
              class="card records-card"
              :class="{ 'records-card-detail': view === 'records' }"
            >
              <div class="section-head">
                <div>
                  <h2>
                    {{ view === "overview" ? "最近的生活记录" : "收支记录"
                    }}<span class="count-label">{{ records.total }} 笔</span>
                  </h2>
                  <p>
                    {{
                      view === "overview"
                        ? "那些日常的小事，都在这里"
                        : "可按时间、类型和分类查找，搜索备注与支付方式"
                    }}
                  </p>
                </div>
                <button
                  v-if="view === 'overview'"
                  class="text-button"
                  @click="navigate('records')"
                >
                  全部明细 <ChevronRight :size="16" />
                </button>
              </div>
              <form
                v-if="view === 'records'"
                class="filter-form"
                @submit.prevent="applyFilters"
              >
                <label class="search-input"
                  ><Search :size="17" /><input
                    v-model="filter.q"
                    aria-label="搜索记录"
                    placeholder="搜索大分类、小分类、备注、支付方式"
                    maxlength="100" /></label
                ><label
                  ><span>收支类型</span
                  ><select v-model="filter.type">
                    <option value="">全部类型</option>
                    <option value="expense">支出</option>
                    <option value="income">收入</option>
                  </select></label
                ><label
                  ><span>大分类</span
                  ><input
                    v-model="filter.category"
                    placeholder="全部大分类"
                    list="filter-categories"
                    maxlength="40"
                  /><datalist id="filter-categories">
                    <option
                      v-for="c in [...expenseCategories, ...incomeCategories]"
                      :key="c"
                    >
                      {{ c }}
                    </option>
                  </datalist></label
                ><label
                  ><span>小分类</span
                  ><input
                    v-model="filter.subcategory"
                    placeholder="全部小分类"
                    list="filter-subcategories"
                    maxlength="40"
                  /><datalist id="filter-subcategories">
                    <option
                      v-for="sub in filterSubcategoryOptions"
                      :key="sub"
                    >
                      {{ sub }}
                    </option>
                  </datalist></label
                ><label
                  ><span>开始日期</span
                  ><input
                    v-model="filter.from"
                    type="date"
                    aria-label="开始日期" /></label
                ><label class="filter-end"
                  ><span>结束日期</span
                  ><input
                    v-model="filter.to"
                    type="date"
                    aria-label="结束日期" /></label
                ><button class="primary" type="submit">筛选</button
                ><button class="secondary" type="button" @click="resetFilters">
                  重置
                </button>
              </form>
              <div v-if="recordsError" class="error-banner" role="alert">
                {{ recordsError
                }}<button class="text-button" @click="loadRecords">
                  重新加载
                </button>
              </div>
              <div v-else-if="loadingRecords" class="loading-panel">
                <span class="spinner" /> 正在加载记录…
              </div>
              <div v-else-if="!records.items.length" class="empty-state">
                <span class="empty-icon"><Wallet :size="30" /></span>
                <h3>
                  {{ records.total ? "这一页没有记录" : "这里还没有记录" }}
                </h3>
                <p>
                  {{
                    Object.values(appliedFilter).some(Boolean) || memberFilter
                      ? "试试调整筛选条件，看看其他生活片段。"
                      : "一顿饭、一份工资，都是记录生活的开始。"
                  }}
                </p>
                <button
                  v-if="!readOnlyBook"
                  class="secondary"
                  @click="openRecord()"
                >
                  <Plus :size="16" /> 记下第一笔
                </button>
              </div>
              <div v-else class="table-wrap">
                <table class="records-table">
                  <thead>
                    <tr>
                      <th>分类/备注</th>
                      <th v-if="isFamilyBook">记录人</th>
                      <th>时间（北京）</th>
                      <th>支付方式</th>
                      <th class="amount-col">金额</th>
                      <th class="actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="record in view === 'overview'
                        ? records.items.slice(0, 5)
                        : records.items"
                      :key="record.id"
                    >
                      <td>
                        <div class="record-description">
                          <span
                            class="record-icon"
                            :class="record.type"
                            :style="{
                              '--category-color': categoryColor(record.category),
                            }"
                            ><OptionIcon
                              :kind="record.type"
                              :name="record.category"
                              :icon="recordIcon(record.type, record.category)"
                              :size="18" /></span
                          ><span
                            ><strong
                              >{{ record.category
                              }}<template v-if="record.subcategory">
                                · {{ record.subcategory }}</template
                              ></strong
                            ><small>{{
                              record.note ||
                              (record.type === "income" ? "收入" : "支出")
                            }}</small></span
                          >
                        </div>
                      </td>
                      <td v-if="isFamilyBook">
                        {{
                          displayMemberName(
                            record.createdBy,
                            record.createdByName || "未知成员",
                          )
                        }}
                      </td>
                      <td class="date-cell">
                        {{ recordDate(record.occurredAt) }}
                      </td>
                      <td>
                        <span class="payment-tag"
                          ><OptionIcon
                            kind="payment"
                            :name="record.paymentSource"
                            :icon="recordIcon('payment', record.paymentSource)"
                            :size="14"
                          />{{ record.paymentSource }}</span
                        >
                      </td>
                      <td
                        class="amount-col"
                        :class="{ 'income-text': record.type === 'income' }"
                      >
                        <strong
                          >{{ record.type === "income" ? "+" : "−"
                          }}{{ money(record.amountCents) }}</strong
                        >
                      </td>
                      <td class="actions-col">
                        <div
                          v-if="canEdit(record, activeBook, user.id)"
                          class="row-actions"
                        >
                          <button
                            class="icon-button"
                            :aria-label="`编辑${record.category}记录`"
                            @click="openRecord(record)"
                          >
                            <Pencil :size="16" /></button
                          ><button
                            class="icon-button danger-hover"
                            :aria-label="`删除${record.category}记录`"
                            @click="removeRecord(record)"
                          >
                            <Trash2 :size="16" />
                          </button>
                        </div>
                        <span v-else class="tiny muted">仅可查看</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div
                v-if="view === 'records' && records.total"
                class="pagination"
              >
                <span>共 {{ records.total }} 笔 · 每页 20 笔</span>
                <div>
                  <button
                    class="icon-button"
                    aria-label="上一页"
                    :disabled="page <= 1 || loadingRecords"
                    @click="page--"
                  >
                    <ChevronLeft :size="18" /></button
                  ><span
                    >{{ page }} /
                    {{ Math.max(1, Math.ceil(records.total / 20)) }}</span
                  ><button
                    class="icon-button"
                    aria-label="下一页"
                    :disabled="
                      page >= Math.ceil(records.total / 20) || loadingRecords
                    "
                    @click="page++"
                  >
                    <ChevronRight :size="18" />
                  </button>
                </div>
              </div>
            </section>
            <div v-if="view === 'overview'" class="gentle-note">
              <Leaf :size="18" /><span
                >记账不是限制生活，而是让每一份花费，都更接近你想要的日子。</span
              >
            </div>
          </template></template
        >
        <template v-else-if="view === 'members'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow">A HOME WE BUILD TOGETHER</span>
              <h1>一起照顾小家的账</h1>
              <p>管理账本信息与共享成员，让每一笔都清楚。</p>
            </div>
            <button class="primary" @click="newBook()">
              <Plus :size="18" /> 新建账本
            </button>
          </div>
          <div v-if="!activeBook" class="card empty-state">
            <BookOpen :size="36" />
            <h2>先创建一本账本吧</h2>
            <button class="primary" @click="newBook()">创建账本</button>
          </div>
          <section v-else-if="readOnlyBook" class="card management-card">
            <div class="section-head">
              <div>
                <h2>{{ activeBook.name }}</h2>
                <p>他人分享给你的只读账本</p>
              </div>
              <span class="type-pill">只读</span>
            </div>
            <div class="management-info">
              <span>你的角色</span><strong>只读访客</strong>
            </div>
            <div v-if="activeBook.ownerPhone" class="management-info">
              <span>分享者</span
              ><strong
                >{{ activeBook.ownerName || "对方" }} ·
                {{ activeBook.ownerPhone }}</strong
              >
            </div>
            <div class="management-info">
              <span>创建于</span
              ><strong>{{
                shanghaiDay(new Date(activeBook.createdAt))
              }}</strong>
            </div>
            <div class="info-note">
              <CircleHelp :size="18" />
              <p>
                账本拥有者可以随时取消分享。你可以查看记录和收支分析；如需共同记账，请让拥有者邀请你加入家庭账本（个人账本无法共同记账）。
              </p>
            </div>
          </section>
          <template v-else
            ><section class="card management-card">
              <div class="section-head">
                <div>
                  <h2>{{ activeBook.name }}</h2>
                  <p>
                    {{
                      activeBook.type === "personal"
                        ? "个人账本 · 仅你自己可见"
                        : "家庭账本 · 家人共享收支记录"
                    }}
                  </p>
                </div>
                <span class="type-pill">{{
                  activeBook.type === "family" ? "家庭" : "个人"
                }}</span>
              </div>
              <div class="management-info">
                <span>你的角色</span
                ><strong>{{ isOwner ? "账本拥有者" : "家庭成员" }}</strong>
              </div>
              <div class="management-info">
                <span>创建于</span
                ><strong>{{
                  shanghaiDay(new Date(activeBook.createdAt))
                }}</strong>
              </div>
              <div class="button-row">
                <button
                  class="secondary transfer-action"
                  @click="transferMode = 'export'"
                >
                  导出账本
                </button>
                <button
                  class="secondary transfer-action"
                  @click="transferMode = 'import'"
                >
                  导入账本
                </button>
              </div>
              <div v-if="isOwner" class="button-row">
                <button class="secondary" @click="newBook(true)">
                  <Pencil :size="16" /> 更改名称</button
                ><button class="danger-outline" @click="deleteBook">
                  <Trash2 :size="16" /> 删除账本
                </button>
              </div>
              <p class="tiny muted">
                {{
                  activeBook.type === "personal"
                    ? "个人账本仅本人可见，可以更名或删除，不支持邀请成员。"
                    : isOwner
                      ? "你是家庭账本拥有者，可以更名、删除账本及邀请成员。"
                      : "你是家庭成员，可以新增记录；邀请成员、更名和删除账本需由拥有者操作。"
                }}
              </p>
            </section>
            <section class="card management-card">
              <div class="section-head">
                <div>
                  <h2>
                    {{
                      activeBook.type === "family" ? "小家的成员" : "账本成员"
                    }}
                  </h2>
                  <p>记录创建者和账本拥有者可编辑记录</p>
                </div>
                <Users :size="21" class="muted" />
              </div>
              <div v-if="membersLoading" class="loading-panel">
                <span class="spinner" /> 正在加载成员…
              </div>
              <div v-else-if="membersError" class="error-banner">
                {{ membersError
                }}<button @click="loadMembers" class="text-button">重试</button>
              </div>
              <div
                v-for="member in members"
                v-else
                :key="member.id"
                class="member-row"
              >
                <span class="avatar">{{ member.name.slice(0, 1) }}</span>
                <div>
                  <strong
                    >{{ member.name }}
                    <span v-if="member.id === user.id" class="tiny muted"
                      >（你）</span
                    ></strong
                  ><small>{{ member.phone }}</small>
                </div>
                <span class="member-role">{{
                  member.id === activeBook.ownerId ? "拥有者" : "成员"
                }}</span><button
                  v-if="
                    member.id !== activeBook.ownerId &&
                    (isOwner || member.id === user.id)
                  "
                  class="text-button danger-text"
                  @click="removeMember(member)"
                >
                  {{ member.id === user.id ? "退出账本" : "移除" }}
                </button>
              </div>
              <template v-if="canInviteMembers"
                ><form class="invite-form" @submit.prevent="sendInvite">
                  <label
                    >邀请家人手机号<input
                      v-model="invitePhone"
                      @input="inviteError = ''"
                      type="tel"
                      placeholder="请输入 11 位手机号"
                      pattern="1[3-9][0-9]{9}"
                      maxlength="11"
                      required
                      autocomplete="off" /></label
                  ><button class="primary" :disabled="busy">
                    <Plus :size="17" /> 发送邀请
                  </button>
                </form>
                <p v-if="inviteError" class="form-error" role="alert">
                  {{ inviteError }}
                </p>
                <div class="info-note">
                  <CircleHelp :size="18" />
                  <p>
                    只能邀请<strong>已注册小家有账的手机号</strong>，未注册的号码请先注册后再邀请。邀请在平台内送达，<strong>不会发送短信</strong>，对方登录后可在「我的邀请」接受。
                  </p>
                </div></template
              >
              <div v-else-if="activeBook.type === 'personal'" class="info-note">
                <Leaf :size="18" />
                <p>个人账本仅本人可见。如需和家人共享，请新建家庭账本。</p>
              </div>
              <div v-else class="info-note">
                <CircleHelp :size="18" />
                <p>
                  只有家庭账本拥有者可以邀请新成员。你当前是家庭成员，请联系拥有者发送邀请。
                </p>
              </div>
            </section></template
          ></template
        >
        <template v-else-if="view === 'options'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow">A TIDY LEDGER STARTS HERE</span>
              <h1>分类与支付方式</h1>
              <p>集中管理大分类、小分类和支付方式，记账时直接选择。</p>
            </div>
            <button
              class="secondary"
              :disabled="busy || optionsLoading"
              @click="mutate(loadRecordOptions)"
            >
              刷新
            </button>
          </div>
          <div v-if="optionsLoading" class="loading-panel">
            <span class="spinner" /> 正在加载分类与支付方式…
          </div>
          <OptionManager
            v-else
            :options="recordOptions"
            @changed="recordOptions = $event"
          />
        </template>
        <template v-else-if="view === 'invitations'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow">YOU ARE INVITED HOME</span>
              <h1>来自家人和朋友的邀请</h1>
              <p>当前手机号 {{ user.phone }} 的待接受邀请与只读分享</p>
            </div>
            <button
              class="secondary"
              :disabled="busy"
              @click="mutate(refreshInbox)"
            >
              刷新
            </button>
          </div>
          <div class="info-note invitation-info">
            <Bell :size="19" />
            <p>
              这里是当前账号收到的家庭账本邀请和只读分享，与左侧选择的账本无关。消息仅在平台内显示，不发送短信；只读分享需要你接受后才能查看。
            </p>
          </div>
          <section v-if="receivedShares.length" class="invitation-group">
            <h2 class="invitation-group-title">
              <BookOpen :size="18" /> 分享给我的账本
            </h2>
            <section
              v-for="share in receivedShares"
              :key="share.id"
              class="card invitation-card"
            >
              <span class="empty-icon"><BookOpen :size="26" /></span>
              <div>
                <h2>{{ share.bookName }}</h2>
                <p>
                  {{ share.ownerName
                  }}<template v-if="share.ownerPhone"
                    >（{{ share.ownerPhone }}）</template
                  >
                  邀请你只读查看账本
                </p>
                <small class="muted"
                  >{{ shanghaiDay(new Date(share.createdAt)) }} ·
                  接受后可查看记录和分析，不能修改</small
                >
              </div>
              <div class="button-row">
                <button
                  class="secondary"
                  :disabled="busy"
                  @click="
                    confirm(
                      '拒绝分享？',
                      `拒绝查看「${share.bookName}」后，对方可再次分享给你。`,
                      () => processShare(share, false),
                      '拒绝分享',
                      false,
                    )
                  "
                >
                  拒绝</button
                ><button
                  class="primary"
                  :disabled="busy"
                  @click="respondShare(share, true)"
                >
                  <Check :size="17" /> 接受分享
                </button>
              </div>
            </section>
          </section>
          <section v-if="invitations.length" class="invitation-group">
            <h2 class="invitation-group-title">
              <Users :size="18" /> 家庭账本邀请
            </h2>
            <section
              v-for="invite in invitations"
              :key="invite.id"
              class="card invitation-card"
            >
              <span class="empty-icon"><Users :size="26" /></span>
              <div>
                <h2>{{ invite.bookName }}</h2>
                <p>{{ invite.inviterName }} 邀请你加入家庭账本</p>
                <small class="muted"
                  >{{ shanghaiDay(new Date(invite.createdAt)) }} · 邀请至
                  {{ invite.phone }}</small
                >
              </div>
              <div class="button-row">
                <button
                  class="secondary"
                  :disabled="busy"
                  @click="
                    confirm(
                      '拒绝邀请？',
                      `拒绝加入「${invite.bookName}」后，对方可再次邀请你。`,
                      () => processInvite(invite, false),
                      '拒绝邀请',
                      false,
                    )
                  "
                >
                  拒绝</button
                ><button
                  class="primary"
                  :disabled="busy"
                  @click="respondInvite(invite, true)"
                >
                  <Check :size="17" /> 接受邀请
                </button>
              </div>
            </section>
          </section>
          <div
            v-if="!invitations.length && !receivedShares.length"
            class="card empty-state large"
          >
            <span class="empty-icon"><Bell :size="34" /></span>
            <h2>暂时没有新邀请</h2>
            <p>家人邀请或朋友分享账本后，<br />会显示在这里。</p>
          </div></template
        >
        <template v-else-if="view === 'account'"
          ><div class="page-heading">
            <div>
              <span class="eyebrow">YOUR OWN LITTLE SPACE</span>
              <h1>账户与安全</h1>
              <p>照顾好账户，也照顾好小家的隐私。</p>
            </div>
          </div>
          <div class="account-grid">
            <section class="card account-profile">
              <span class="avatar large">{{ user.name.slice(0, 1) }}</span>
              <h2>{{ user.name }}</h2>
              <p>{{ user.phone }}</p>
              <div class="info-note">
                <Leaf :size="18" />
                <p>个人账本仅你可见。家庭账本仅拥有者与已加入的成员可访问。</p>
              </div>
            </section>
            <div>
              <section class="card security-card">
                <h2>修改密码</h2>
                <p class="muted">修改后，其他设备的登录会失效。</p>
                <form @submit.prevent="updateSecurity('password')">
                  <label
                    >当前密码<input
                      v-model="security.currentPassword"
                      type="password"
                      autocomplete="current-password"
                      required
                      maxlength="72" /></label
                  ><label
                    >新密码<input
                      v-model="security.newPassword"
                      type="password"
                      placeholder="8–72 位新密码"
                      autocomplete="new-password"
                      minlength="8"
                      maxlength="72"
                      required /></label
                  ><button class="primary" :disabled="busy">
                    {{ busy ? "正在保存…" : "更新密码" }}
                  </button>
                </form>
              </section>
              <section class="card security-card">
                <h2>更换手机号</h2>
                <p class="muted">需验证当前密码和新手机号收到的短信验证码。</p>
                <form @submit.prevent="updateSecurity('phone')">
                  <label
                    >新手机号<input
                      v-model="security.phone"
                      type="tel"
                      pattern="1[3-9][0-9]{9}"
                      maxlength="11"
                      autocomplete="tel"
                      placeholder="请输入新的 11 位手机号"
                      required /></label
                  ><label
                    >当前密码<input
                      v-model="security.currentPassword"
                      type="password"
                      autocomplete="current-password"
                      required
                      maxlength="72" /></label
                  ><div class="sms-field">
              <label>短信验证码<input v-model="changeSmsCode" inputmode="numeric" autocomplete="one-time-code" placeholder="请输入 6 位验证码" pattern="[0-9]{6}" maxlength="6" required /></label>
              <button type="button" class="secondary" :disabled="changeSmsSending || changeSmsSeconds > 0 || !/^1[3-9][0-9]{9}$/.test(security.phone) || busy" @click="sendChangeSms()">
                {{ changeSmsSending ? "发送中…" : changeSmsSeconds ? `${changeSmsSeconds} 秒后重发` : changeChallenge ? "验证并发送短信" : "获取验证码" }}
              </button>
              <div v-if="changeChallenge" class="sms-field">
                <img :src="changeChallenge.image" width="150" height="48" alt="短信发送前的图形验证码" />
                <button type="button" class="secondary" :disabled="changeSmsSending" @click="sendChangeSms(true)">换一张</button>
                <label>图形验证码<input v-model="changeAnswer" autocomplete="off" maxlength="5" placeholder="输入五位字母或数字" /></label>
              </div>
              <p v-if="changeSmsError" class="form-error" role="alert">{{ changeSmsError }}</p>
            </div>
            <button class="primary" :disabled="busy">
                    {{ busy ? "正在保存…" : "更换手机号" }}
                  </button>
                </form>
                <p class="tiny muted">
                  更换后，将接收发送给新手机号的待接受邀请。
                </p>
              </section>
            </div>
          </div>
          <section class="card theme-card">
            <div class="section-head">
              <div>
                <h2>界面色调</h2>
                <p>选择你喜欢的配色，立即生效并同步到当前账号。</p>
              </div>
              <span v-if="themeSaving" class="tiny muted" role="status">正在保存…</span>
            </div>
            <ThemePicker
              :model-value="theme"
              :disabled="themeSaving"
              @update:model-value="chooseTheme"
            />
            <p class="tiny muted theme-footnote">
              主题偏好属于外观设置，不影响账目数据；换设备登录后会自动沿用。
            </p>
          </section></template
        >
        <footer class="page-footer">
          小家有账 <span>·</span> 把生活，一笔笔过好
        </footer>
      </div>
    </main>
  </div>
  <DataTransfer
    v-if="transferMode && activeBook && user && !readOnlyBook"
    :book="activeBook"
    :mode="transferMode"
    @close="transferMode = ''"
    @imported="importedRecords"
    @failure="failure"
    @downloaded="toast"
  />
  <ShareBookDialog
    v-if="shareDialogBook"
    :book-id="shareDialogBook.id"
    :book-name="shareDialogBook.name"
    @close="shareDialogBookId = ''"
  />
  <Modal
    v-if="modal"
    :title="
      modal === 'book'
        ? bookEditing
          ? '更改账本名称'
          : '创建一个新账本'
        : modal === 'record'
          ? editingRecord
            ? '编辑这笔记录'
            : '记下生活的一笔'
          : confirmation.title
    "
    :busy="busy"
    @close="
      modal = '';
      formError = '';
    "
  >
    <form v-if="modal === 'book'" @submit.prevent="saveBook">
      <p class="muted modal-description">
        给日常一个归处，慢慢积攒生活的底气。
      </p>
      <label
        >账本名称<input
          v-model="bookForm.name"
          autofocus
          placeholder="例如：我的日常、小家的生活"
          maxlength="40"
          required
      /></label>
      <fieldset v-if="!bookEditing" class="book-type-choice">
        <legend>账本类型</legend>
        <label :class="{ selected: bookForm.type === 'personal' }"
          ><input
            v-model="bookForm.type"
            type="radio"
            value="personal"
          /><BookOpen :size="24" /><strong>个人账本</strong
          ><small>仅自己可见</small></label
        ><label :class="{ selected: bookForm.type === 'family' }"
          ><input v-model="bookForm.type" type="radio" value="family" /><Users
            :size="24"
          /><strong>家庭账本</strong><small>邀请家人一起记</small></label
        >
      </fieldset>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="modal-actions">
        <button
          class="secondary"
          type="button"
          :disabled="busy"
          @click="modal = ''"
        >
          取消</button
        ><button class="primary" :disabled="busy">
          {{ busy ? "正在保存…" : bookEditing ? "保存名称" : "创建账本" }}
        </button>
      </div>
    </form>
    <form v-else-if="modal === 'record'" @submit.prevent="saveRecord">
      <div class="segmented record-type">
        <button
          type="button"
          :class="{ active: recordForm.type === 'expense' }"
          :disabled="busy"
          @click="setRecordType('expense')"
        >
          <ArrowUpRight :size="17" /> 支出</button
        ><button
          type="button"
          :class="{ active: recordForm.type === 'income' }"
          :disabled="busy"
          @click="setRecordType('income')"
        >
          <ArrowDownLeft :size="17" /> 收入
        </button>
      </div>
      <label class="amount-input"
        >金额（元）
        <div>
          <span>¥</span
          ><input
            v-model="recordForm.amount"
            autofocus
            inputmode="decimal"
            placeholder="0.00"
            aria-label="金额（元）"
            required
            maxlength="14"
          /></div
      ></label>
      <div class="form-grid">
        <SelectInput
          :model-value="recordForm.category"
          label="大分类"
          :icon-kind="recordForm.type === 'income' ? 'income' : 'expense'"
          :icon-overrides="
            recordOptions.icons?.[
              recordForm.type === 'income'
                ? 'incomeCategory'
                : 'expenseCategory'
            ]
          "
          :options="
            recordForm.type === 'expense' ? expenseCategories : incomeCategories
          "
          placeholder="选择或输入大分类"
          :disabled="busy || optionsLoading"
          @update:model-value="setRecordCategory"
        />
        <SelectInput
          v-model="recordForm.subcategory"
          label="小分类"
          :options="subcategoryOptions"
          placeholder="请选择或添加小分类"
          :disabled="busy || optionsLoading || !recordForm.category"
        />
        <SelectInput
          v-model="recordForm.paymentSource"
          label="支付方式"
          icon-kind="payment"
          :icon-overrides="recordOptions.icons?.paymentSource"
          :options="paymentSources"
          placeholder="选择或输入支付方式"
          :disabled="busy || optionsLoading"
        />
        <label
          >时间<input
            v-model="recordForm.occurredAt"
            type="date"
            required
        /></label>
      </div>
      <p v-if="optionsLoading" class="tiny muted">
        正在加载你的常用大分类、小分类和支付方式…
      </p>
      <label
        >备注
        <span class="muted tiny">选填 · {{ recordForm.note.length }}/500</span
        ><textarea
          v-model="recordForm.note"
          placeholder="为这笔记录留下一点生活的细节"
          maxlength="500"
          rows="3"
        ></textarea>
      </label>
      <p
        v-if="formError"
        class="form-error"
        role="alert"
      >
        {{ formError }}
      </p>
      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="modal = ''"
        >
          取消</button
        ><button
          class="primary"
          :disabled="busy"
        >
          {{ busy ? "正在保存…" : editingRecord ? "保存修改" : "记好了" }}
        </button>
      </div>
    </form>
    <template v-else
      ><p class="confirm-message">{{ confirmation.message }}</p>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="modal-actions">
        <button class="secondary" :disabled="busy" @click="modal = ''">
          取消</button
        ><button
          :class="confirmation.danger ? 'danger' : 'primary'"
          :disabled="busy"
          @click="performConfirmation"
        >
          {{ busy ? "请稍候…" : confirmation.label }}
        </button>
      </div></template
    >
  </Modal>
</template>
