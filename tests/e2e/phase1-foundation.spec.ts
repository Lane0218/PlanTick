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
  await page.getByLabel('快速新建任务').focus()
  await expect(page.getByLabel('快速新建任务')).toHaveCSS('outline-style', 'none')

  await page.getByRole('button', { name: '新建分类' }).click()
  await page.getByPlaceholder('分类名称').fill('产品设计')
  await page.getByRole('button', { name: '添加分类' }).click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '分类操作 产品设计' }).click()
  await page.getByRole('menuitem', { name: '修改分类' }).click()
  await expect(page.getByText('修改分类', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '分类操作 产品设计' }).click()
  await page.getByRole('menuitem', { name: '删除分类' }).click()
  await expect(page.getByText('自动移动到“未分类”')).toBeVisible()
  await expect(page.locator('.category-confirm-actions button')).toHaveText(['取消', '确定'])
  await page.locator('.category-confirm-actions button').first().click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await page.getByLabel('快速新建任务').fill('123')
  await page.getByLabel('快速新建任务').press('Enter')
  const noNoteTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 123' }),
  })
  const noNoteStatusBox = await noNoteTask.getByRole('button', { name: '切换任务状态，当前未开始' }).boundingBox()
  const noNoteTitleBox = await noNoteTask.locator('.todo-main strong').boundingBox()
  expect(
    Math.abs(
      (noNoteStatusBox?.y ?? 0) + (noNoteStatusBox?.height ?? 0) / 2 -
        ((noNoteTitleBox?.y ?? 0) + (noNoteTitleBox?.height ?? 0) / 2),
    ),
  ).toBeLessThan(8)

  await page.getByLabel('快速新建任务').fill('完成任务工作台 UI')
  await page.getByLabel('快速新建任务').press('Enter')

  await expect(page.getByLabel('任务标题')).toHaveValue('完成任务工作台 UI')
  const detailPane = page.getByLabel('任务详情')
  const detailPaneBox = await detailPane.boundingBox()
  expect(detailPaneBox?.width ?? 0).toBeGreaterThan(420)
  await expect(detailPane).toHaveCSS('overflow', 'visible')

  await page.getByLabel('备注').fill('右侧详情支持完整编辑任务字段')
  await page.getByRole('button', { name: '选择日期' }).click()
  await expect(page.locator('.detail-calendar-popover')).toBeVisible()
  await expect(page.locator('.detail-calendar-popover .rdp-chevron').first()).toHaveCSS(
    'fill',
    'rgb(31, 110, 102)',
  )
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
  await createdTask.getByRole('button', { name: '切换任务状态，当前进行中' }).click()
  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前已完成' }),
  ).toBeVisible()
  await createdTask.getByRole('button', { name: '切换任务状态，当前已完成' }).click()
  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前阻塞' }),
  ).toBeVisible()
  await createdTask.getByRole('button', { name: '切换任务状态，当前阻塞' }).click()
  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前取消' }),
  ).toBeVisible()
  await createdTask.getByRole('button', { name: '切换任务状态，当前取消' }).click()
  await expect(
    createdTask.getByRole('button', { name: '切换任务状态，当前未开始' }),
  ).toBeVisible()
  await createdTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
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
