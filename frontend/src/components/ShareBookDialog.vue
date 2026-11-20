<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CircleHelp, UserPlus } from "lucide-vue-next";
import { api, type BookShare, type BookShares } from "../api";
import Modal from "./Modal.vue";
const props = defineProps<{ bookId: string; bookName: string }>();
const emit = defineEmits<{ close: [] }>();
const shares = ref<BookShare[]>([]);
const loading = ref(true),
  busy = ref(false),
  error = ref(""),
  status = ref("");
const phone = ref("");
const pendingRevoke = ref("");
const path = `/books/${encodeURIComponent(props.bookId)}/shares`;
const statusLabels: Record<BookShare["status"], string> = {
  pending: "待接受",
  accepted: "已接受",
  rejected: "已拒绝",
};
const statusLabel = (status: BookShare["status"]) => statusLabels[status];
async function load() {
  loading.value = true;
  try {
    const result = await api<BookShares>(path);
    shares.value = result.shares;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "无法加载分享列表，请重试";
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function add() {
  if (busy.value) return;
  const value = phone.value.trim();
  if (!/^1[3-9][0-9]{9}$/.test(value)) {
    error.value = "请输入有效的 11 位手机号";
    return;
  }
  busy.value = true;
  error.value = status.value = "";
  try {
    const share = await api<BookShare>(path, "POST", { phone: value });
    phone.value = "";
    status.value = `分享邀请已发送给 ${share.name}，等待对方接受。`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "分享失败，请重试";
  } finally {
    busy.value = false;
  }
}
async function resend(target: BookShare) {
  if (busy.value) return;
  busy.value = true;
  error.value = status.value = "";
  try {
    await api<BookShare>(path, "POST", { phone: target.phone });
    status.value = `已重新发送给 ${target.name}，等待对方接受。`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "重新分享失败，请重试";
  } finally {
    busy.value = false;
  }
}
async function revoke(target: BookShare) {
  if (busy.value) return;
  busy.value = true;
  error.value = status.value = "";
  try {
    await api(`${path}/${encodeURIComponent(target.userId)}`, "DELETE");
    pendingRevoke.value = "";
    status.value = `已取消对 ${target.name} 的分享。`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "取消分享失败，请重试";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal title="分享账本给指定用户" :busy="busy" @close="emit('close')">
    <p class="share-intro">
      把「{{ bookName }}」以<strong>只读</strong>方式分享给指定的小家有账用户。对方收到邀请并接受后，可在自己的账本列表中查看全部记录和分析，但不能新增或修改。
    </p>
    <form class="invite-form" @submit.prevent="add">
      <label
        >对方手机号<input
          v-model="phone"
          type="tel"
          inputmode="tel"
          placeholder="请输入已注册的 11 位手机号"
          pattern="1[3-9][0-9]{9}"
          maxlength="11"
          autocomplete="off"
          :disabled="busy"
          @input="
            error = '';
            status = '';
          "
      /></label>
      <button class="primary" :disabled="busy || loading">
        <UserPlus :size="17" /> {{ busy ? "处理中…" : "分享" }}
      </button>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="status" class="share-status" role="status">{{ status }}</p>
    <h3 class="share-heading">已分享的用户</h3>
    <p v-if="loading" class="muted">正在加载分享列表…</p>
    <p v-else-if="!shares.length" class="muted">还没有分享给任何人。</p>
    <template v-else>
      <div v-for="share in shares" :key="share.userId" class="share-row">
        <span class="avatar">{{ share.name.slice(0, 1) }}</span>
        <div>
          <strong>{{ share.name }}</strong
          ><small>{{ share.phone }}</small>
        </div>
        <span class="member-role" :class="`share-${share.status}`">{{
          statusLabel(share.status)
        }}</span>
        <template v-if="pendingRevoke === share.userId">
          <button
            class="text-button danger-text"
            :disabled="busy"
            @click="revoke(share)"
          >
            确定取消
          </button>
          <button
            class="text-button"
            :disabled="busy"
            @click="pendingRevoke = ''"
          >
            返回
          </button>
        </template>
        <template v-else>
          <button
            v-if="share.status === 'rejected'"
            class="text-button"
            :disabled="busy"
            @click="resend(share)"
          >
            重新分享
          </button>
          <button
            class="text-button danger-text"
            :disabled="busy"
            @click="pendingRevoke = share.userId"
          >
            取消分享
          </button>
        </template>
      </div>
    </template>
    <div class="info-note">
      <CircleHelp :size="18" />
      <p>
        只能分享给<strong>已注册的小家有账手机号</strong>，未注册的号码请先注册。分享不会发送短信；对方需在「我的邀请」中接受后才能查看。取消分享或删除账本后，对方立即失去查看权限。
      </p>
    </div>
    <div class="modal-actions">
      <button class="secondary" :disabled="busy" @click="emit('close')">
        完成
      </button>
    </div>
  </Modal>
</template>

<style scoped>
.share-intro {
  font-size: 12.5px;
  line-height: 1.9;
  margin: 0 0 16px;
  color: var(--text);
}
.share-intro strong {
  color: var(--text-strong);
}
.share-heading {
  font-size: 13px;
  margin: 22px 0 2px;
}
.share-status {
  color: var(--green);
  font-size: 12px;
  margin-top: 12px;
}
.share-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.share-row > div > strong {
  font-size: 12px;
  font-weight: 550;
}
.share-row small {
  display: block;
  color: var(--text);
  font-size: 10px;
  margin-top: 3px;
}
.share-row .member-role {
  margin-left: auto;
}
.share-row .member-role.share-accepted {
  color: var(--green-dark);
}
.share-row .member-role.share-rejected {
  color: var(--danger);
}
</style>