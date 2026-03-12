import { expect, test } from '@playwright/test'

test('phase 3 主链路：创建工作区、创建分类与任务、编辑详情并刷新恢复', async ({
  page,
  baseURL,
}) => {
  const passphrase = `phase3-${Date.now()}-pw`

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  await page.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(page.getByText('匿名会话已建立，可以创建或加入工作区。')).toBeVisible()

  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '调用 workspace-create' }).click()
  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()
  await expect(page.locator('.sidebar-nav .sidebar-icon svg')).toHaveCount(3)

  await page.getByRole('button', { name: '新建分类' }).click()
  await page.getByPlaceholder('分类名称').fill('产品设计')
  await page.getByRole('button', { name: '添加分类' }).click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '分类操作 产品设计' }).click()
  await page.getByRole('menuitem', { name: '删除分类' }).click()
  await expect(page.locator('.category-confirm-actions button')).toHaveText(['取消', '确定'])
  await page.locator('.category-confirm-actions button').first().click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await page.getByLabel('快速新建任务').fill('完成任务工作台 UI')
  await page.getByLabel('快速新建任务').press('Enter')

  await expect(page.getByLabel('任务标题')).toHaveValue('完成任务工作台 UI')
  const detailPane = page.getByLabel('任务详情')
  const detailPaneBox = await detailPane.boundingBox()
  expect(detailPaneBox?.width ?? 0).toBeGreaterThan(420)

  await page.getByLabel('备注').fill('右侧详情支持完整编辑任务字段')
  await page.getByRole('button', { name: '选择日期' }).click()
  await expect(page.locator('.detail-calendar-popover')).toBeVisible()
  await page.getByRole('button', { name: '明天' }).click()
  const createdTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 完成任务工作台 UI' }),
  })
  await createdTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前进行中' }),
  ).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前进行中' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '明天' })).toHaveClass(/active/)
  await expect(page.getByLabel('备注')).toHaveValue('右侧详情支持完整编辑任务字段')
  await page.waitForTimeout(700)

  await page.reload()

  const restoredTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 完成任务工作台 UI' }),
  })
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看任务 完成任务工作台 UI' })).toBeVisible()
  await page.getByRole('button', { name: '查看任务 完成任务工作台 UI' }).click()
  await expect(page.getByLabel('备注')).toHaveValue(
    '右侧详情支持完整编辑任务字段',
  )
  await expect(page.getByRole('button', { name: '明天' })).toHaveClass(/active/)
  await expect(
    restoredTask.getByRole('button', { name: '切换任务状态，当前进行中' }),
  ).toBeVisible()
  await expect(restoredTask.getByText('明天')).toBeVisible()
})
