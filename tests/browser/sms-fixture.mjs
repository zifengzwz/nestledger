import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function smsCode(...scope) {
  return execFileSync('python3', [fileURLToPath(new URL('../sms_fixture.py', import.meta.url)), ...scope], {
    encoding: 'utf8', timeout: 8000,
  }).trim();
}

export function registerWithSms(request, { data, ...options }) {
  const base = new URL(process.env.NESTLEDGER_TEST_URL);
  return request.post(new URL('/api/auth/register', base).href, {
    ...options, data: { ...data, smsCode: smsCode(data.phone) },
  });
}
