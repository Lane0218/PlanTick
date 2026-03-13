import { expect, test } from '@playwright/test'

function formatMonthDay(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function weekdayLabel(date: Date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

test('phase 3 主链路：创建工作区、创建分类与任务、编辑详情并刷新恢复', async ({
  page,
  baseURL,
}) => {
  const passphrase = `phase3-${Date.now()}-pw`
  const today = new Date()
  const weeklyDueLabel = formatMonthDay(addDays(today, 7))
  const monthlyDueLabel = formatMonthDay(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()))

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  const createCategory = async (name: string) => {
    await page.getByRole('button', { name: '新建分类' }).click()
    await page.getByPlaceholder('分类名称').fill(name)
    await page.getByRole('button', { name: '添加分类' }).click()
    await expect(page.getByRole('button', { name: name, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(page.getByText('匿名会话已建立，可以创建或加入工作区。')).toBeVisible()

  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '调用 workspace-create' }).click()
  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()
  await expect(page.locator('.sidebar-nav .sidebar-icon svg')).toHaveCount(3)
  await page.getByLabel('快速新建任务').focus()
  await expect(page.getByLabel('快速新建任务')).toHaveCSS('outline-style', 'none')

  await createCategory('产品设计')
  await expect(page.getByRole('heading', { name: '暂无任务' })).toBeVisible()
  await expect(page.getByText('从上方输入框开始添加第一条任务。')).toHaveCount(0)

  await page.getByRole('button', { name: '编辑分类 产品设计' }).click()
  await expect(page.getByText('编辑分类', { exact: true })).toHaveCount(1)
  await page.getByLabel('关闭分类对话框').click()

  await page.getByRole('button', { name: '编辑分类 产品设计' }).click()
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('自动移动到“未分类”')).toBeVisible()
  await expect(page.locator('.category-confirm-actions button')).toHaveText(['取消', '确定'])
  await page.locator('.category-confirm-actions button').first().click()
  await expect(page.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()

  await createCategory('甲')
  await createCategory('乙')
  await createCategory('丙')

  await page.getByRole('button', { name: '待办箱' }).click()

  await page.getByLabel('快速新建任务').fill('123')
  await page.getByLabel('快速新建任务').press('Enter')
  await page.getByRole('button', { name: '查看任务 123' }).click()
  await expect(page.getByLabel('任务分类').getByRole('button', { name: '未分类' })).toBeVisible()
  await page.getByRole('button', { name: '重复' }).click()
  await expect(page.getByRole('menuitemradio', { name: '每天' })).toBeDisabled()
  await expect(page.getByText('先设置日期后才能开启每天、每周或每月重复。')).toBeVisible()
  await page.getByRole('button', { name: '重复' }).click()
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

  await page.locator('.sidebar-category-section').getByRole('button', { name: '丙', exact: true }).click()
  await page.getByLabel('快速新建任务').fill('完成任务工作台 UI')
  await page.getByLabel('快速新建任务').press('Enter')

  await expect(page.getByLabel('任务标题')).toHaveValue('完成任务工作台 UI')
  await page.getByLabel('任务标题').focus()
  await expect(page.getByLabel('任务标题')).toHaveCSS('outline-style', 'none')
  await expect(page.getByLabel('备注')).toHaveCSS('outline-style', 'none')
  const detailPane = page.getByLabel('任务详情')
  const detailPaneBox = await detailPane.boundingBox()
  expect(detailPaneBox?.width ?? 0).toBeGreaterThan(420)
  await expect(detailPane).toHaveCSS('overflow', 'visible')
  await expect(page.locator('.board-pane')).toHaveCSS('border-right-width', '0px')
  await expect(detailPane).toHaveCSS('border-left-width', '1px')
  await expect(detailPane.locator('.detail-category-strip > .detail-list-select')).toHaveCount(0)
  await expect(detailPane.getByRole('button', { name: '产品设计', exact: true })).toBeVisible()
  await expect(detailPane.getByRole('button', { name: '甲', exact: true })).toBeVisible()
  await expect(detailPane.getByRole('button', { name: '乙', exact: true })).toBeVisible()
  await expect(detailPane.getByRole('button', { name: '丙', exact: true })).toBeVisible()

  await page.getByLabel('备注').fill('右侧详情支持完整编辑任务字段')
  await page.getByRole('button', { name: '选择日期' }).click()
  const calendarPopover = page.locator('.detail-calendar-popover')
  await expect(calendarPopover).toBeVisible()
  const calendarBox = await calendarPopover.boundingBox()
  expect((calendarBox?.x ?? 0) + 1).toBeGreaterThanOrEqual(detailPaneBox?.x ?? 0)
  await expect(page.locator('.detail-calendar-popover .rdp-chevron').first()).toHaveCSS(
    'fill',
    'rgb(31, 110, 102)',
  )
  await expect(page.locator('.detail-calendar-popover .rdp-today .rdp-day_button')).toHaveCSS(
    'border-top-color',
    'rgb(31, 110, 102)',
  )
  await expect(page.locator('.detail-calendar-popover .rdp-outside').first()).toHaveCSS(
    'opacity',
    '0.42',
  )
  await page.getByRole('button', { name: '明天' }).click()
  const createdTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 完成任务工作台 UI' }),
  })
  const createdTaskBox = await createdTask.boundingBox()
  expect((createdTaskBox?.x ?? 0) + (createdTaskBox?.width ?? 0)).toBeGreaterThanOrEqual(
    (detailPaneBox?.x ?? 0) - 2,
  )
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

  await page.getByLabel('快速新建任务').fill('每日例行')
  await page.getByLabel('快速新建任务').press('Enter')
  await page.getByRole('button', { name: '明天' }).click()
  await page.getByRole('button', { name: '重复' }).click()
  await page.getByRole('menuitemradio', { name: '每天' }).click()
  await expect(page.getByRole('button', { name: '每天' })).toBeVisible()
  const dailyTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 每日例行' }),
  })
  await dailyTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await dailyTask.getByRole('button', { name: '切换任务状态，当前进行中' }).click()
  await expect(page.getByRole('button', { name: '查看任务 每日例行' })).toHaveCount(2)
  await expect(
    page.locator('article', {
      has: page.getByRole('button', { name: '切换任务状态，当前未开始' }),
      hasText: '每日例行',
    }).getByText('后天'),
  ).toBeVisible()

  await page.getByLabel('快速新建任务').fill('每周例行')
  await page.getByLabel('快速新建任务').press('Enter')
  await page.getByRole('button', { name: '今天' }).click()
  await page.getByRole('button', { name: '重复' }).click()
  await page.getByRole('menuitemradio', { name: `每周（${weekdayLabel(today)}）` }).click()
  const weeklyTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 每周例行' }),
  })
  await weeklyTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await weeklyTask.getByRole('button', { name: '切换任务状态，当前进行中' }).click()
  await expect(page.getByRole('button', { name: '查看任务 每周例行' })).toHaveCount(2)
  await expect(
    page.locator('article', {
      has: page.getByRole('button', { name: '切换任务状态，当前未开始' }),
      hasText: '每周例行',
    }).getByText(weeklyDueLabel),
  ).toBeVisible()

  await page.getByLabel('快速新建任务').fill('每月例行')
  await page.getByLabel('快速新建任务').press('Enter')
  await page.getByRole('button', { name: '今天' }).click()
  await page.getByRole('button', { name: '重复' }).click()
  await page.getByRole('menuitemradio', { name: `每月（${today.getDate()}日）` }).click()
  const monthlyTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 每月例行' }),
  })
  await monthlyTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await monthlyTask.getByRole('button', { name: '切换任务状态，当前进行中' }).click()
  await expect(page.getByRole('button', { name: '查看任务 每月例行' })).toHaveCount(2)
  await expect(
    page.locator('article', {
      has: page.getByRole('button', { name: '切换任务状态，当前未开始' }),
      hasText: '每月例行',
    }).getByText(monthlyDueLabel),
  ).toBeVisible()
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
