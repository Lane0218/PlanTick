import { expect, test } from '@playwright/test'

test('phase 1 主链路：创建工作区、写入本地样本、第二上下文加入、路由切换', async ({
  browser,
  baseURL,
}) => {
  const passphrase = `phase1-${Date.now()}-pw`

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await pageA.goto(baseURL!)

  await pageA.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(pageA.getByText('匿名登录成功，可调用受限 Edge Function')).toBeVisible()

  await pageA.getByPlaceholder('至少 6 个字符').fill(passphrase)
  await pageA.getByRole('button', { name: '调用 workspace-create' }).click()
  await expect(pageA.getByText('创建工作区成功')).toBeVisible()

  await pageA.getByRole('button', { name: '写入本地样本并加入 outbox' }).click()
  await expect(
    pageA.getByText('已写入本地 categories/todos/events 样本，并加入 outbox。'),
  ).toBeVisible()

  await expect(pageA.getByText('本地分类数：1')).toBeVisible()
  await expect(pageA.getByText('本地待办数：1')).toBeVisible()
  await expect(pageA.getByText('本地事件数：1')).toBeVisible()
  await expect(pageA.getByText('待同步 outbox：3')).toBeVisible()

  await pageA.getByRole('link', { name: '待办骨架' }).click()
  await expect(pageA.getByText('待办模块骨架已建好，业务列表下一阶段接入。')).toBeVisible()

  await pageA.getByRole('link', { name: '月历骨架' }).click()
  await expect(pageA.getByText('月历模块骨架已建好，事件映射和投影下一阶段接入。')).toBeVisible()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await pageB.goto(baseURL!)

  await pageB.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(pageB.getByText('匿名登录成功，可调用受限 Edge Function')).toBeVisible()

  await pageB.getByRole('button', { name: '加入口令工作区' }).click()
  await pageB.getByPlaceholder('至少 6 个字符').fill(passphrase)
  await pageB.getByRole('button', { name: '调用 workspace-join' }).click()
  await expect(pageB.getByText('加入工作区成功')).toBeVisible()

  await contextA.close()
  await contextB.close()
})
