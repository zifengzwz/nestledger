import { test, expect } from '@playwright/test';

test('注册先检查手机号、确认密码和短信图形验证码', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const phone = page.getByLabel('手机号', { exact: true });
  await phone.fill('12000000000');
  await expect(page.getByRole('button', { name: '获取验证码' })).toBeDisabled();
  await phone.fill('13900000000');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('img', { name: '短信发送前的图形验证码' })).toBeVisible();
  await page.getByLabel('图形验证码', { exact: true }).fill('00000');
  await page.getByRole('button', { name: '验证并发送短信' }).click();
  await expect(page.getByRole('alert')).toContainText('图形验证码错误或已失效');
  await page.getByLabel('你的称呼').fill('短信测试');
  await page.getByLabel('密码', { exact: true }).fill('Sms-Password-Example!');
  await page.getByLabel('确认密码', { exact: true }).fill('Sms-Password-Different!');
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '注册并开启记账' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' })).toBeVisible();
});
