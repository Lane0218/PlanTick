import { expect, test } from '@playwright/test'

test('phase 3 主链路：创建工作区、创建分类与任务、编辑详情并刷新恢复', async ({
  page,
  baseURL,
}) => {
  const passphrase = `phase3-${Date.now()}-pw`

  await page.goto(baseURL!)

  await page.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(page.getByText('匿名会话已建立，可以创建或加入工作区。')).toBeVisible()

  await page.getByPlaceholder('至少 6 个字符').fill(passphrase)
  await page.getByRole('button', { name: '调用 workspace-create' }).click()
  await expect(page.getByRole('heading', { name: '全部任务' })).toBeVisible()

  await page.getByRole('button', { name: '切换分类管理' }).click()
  await page.getByPlaceholder('例如：工作、生活、学习').fill('产品设计')
  await page.getByRole('button', { name: '添加分类' }).click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await page.getByLabel('快速新建任务').fill('完成任务工作台 UI')
  await page.locator('input[name="quickTodoDueDate"]').fill('2026-03-20')
  await page.getByRole('button', { name: '添加任务' }).click()

  await expect(page.getByLabel('任务标题')).toHaveValue('完成任务工作台 UI')

  await page.getByLabel('备注').fill('右侧详情支持完整编辑任务字段')
  await page.getByLabel('日期').fill('2026-03-21')
  await page.getByRole('button', { name: '未开始', exact: true }).click()

  await expect(page.getByRole('button', { name: '进行中', exact: true })).toBeVisible()
  await expect(page.getByLabel('日期')).toHaveValue('2026-03-21')
  await expect(page.getByLabel('备注')).toHaveValue('右侧详情支持完整编辑任务字段')
  await page.waitForTimeout(700)

  await page.reload()

  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务 完成任务工作台 UI' })).toBeVisible()
  await page.getByRole('button', { name: '查看任务 完成任务工作台 UI' }).click()
  await expect(page.getByLabel('备注')).toHaveValue(
    '右侧详情支持完整编辑任务字段',
  )
  await expect(page.getByLabel('日期')).toHaveValue('2026-03-21')
  await expect(page.getByRole('button', { name: '进行中', exact: true })).toBeVisible()
})
