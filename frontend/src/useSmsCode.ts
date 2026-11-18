import { onScopeDispose, ref, watch } from "vue";

type SmsPurpose = "register" | "phone_change" | "reset_password";
type SmsRequest = { phone: string; purpose: SmsPurpose };

export const isSmsCode = (value: string) => /^[0-9]{6}$/.test(value);

export function useSmsCode(
  phone: () => string,
  purpose: SmsPurpose,
  sendRequest: (body: SmsRequest & { challengeId: string; challengeCode: string }) => Promise<{ retryAfter: number }>,
  requestChallenge: (body: SmsRequest) => Promise<{ challengeId: string; image: string }>,
) {
  const code = ref("");
  const challenge = ref<{ challengeId: string; image: string }>();
  const answer = ref("");
  const error = ref("");
  const seconds = ref(0);
  const sending = ref(false);
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stopTimer() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function reset() {
    generation++;
    stopTimer();
    code.value = "";
    challenge.value = undefined;
    answer.value = "";
    error.value = "";
    seconds.value = 0;
    sending.value = false;
  }

  watch(phone, reset, { flush: "sync" });
  onScopeDispose(reset);

  async function send(refresh = false) {
    if (sending.value || seconds.value > 0) return;
    const target = phone().trim();
    if (!/^1[3-9][0-9]{9}$/.test(target)) {
      error.value = "请输入有效的中国大陆手机号";
      return;
    }
    const current = generation;
    sending.value = true;
    error.value = "";
    try {
      if (!challenge.value || refresh) {
        challenge.value = undefined;
        answer.value = "";
        const item = await requestChallenge({ phone: target, purpose });
        if (current === generation) challenge.value = item;
        return;
      }
      const challengeCode = answer.value.trim();
      if (!/^[A-Za-z0-9]{5}$/.test(challengeCode)) {
        error.value = "请输入图中的五位字母或数字";
        return;
      }
      const challengeId = challenge.value.challengeId;
      challenge.value = undefined;
      answer.value = "";
      const { retryAfter } = await sendRequest({ phone: target, purpose, challengeId, challengeCode });
      if (current !== generation) return;
      const deadline = Date.now() + retryAfter * 1000;
      const tick = () => {
        seconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (!seconds.value) stopTimer();
      };
      tick();
      if (seconds.value > 0) timer = setInterval(tick, 250);
    } catch (cause) {
      if (current === generation) {
        error.value = cause instanceof Error && cause.message
          ? cause.message
          : "验证码发送失败，请稍后重试";
      }
    } finally {
      if (current === generation) sending.value = false;
    }
  }

  return { code, error, seconds, sending, challenge, answer, send, reset };
}
