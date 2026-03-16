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
  await expect(page.locator('.sidebar-nav .sidebar-icon svg')).toHaveCount(4)
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
  await expect(page.locator('.detail-repeat-options').getByRole('button', { name: '每天', exact: true })).toBeDisabled()
  await expect(page.locator('.detail-pane.is-open').getByRole('button', { name: '我的一天', exact: true })).toBeVisible()
  await page.locator('.detail-pane.is-open').getByRole('button', { name: '我的一天', exact: true }).click()
  await expect(page.locator('.detail-myday-pill')).toHaveClass(/is-active/)
  const myDayButton = page.locator('.sidebar-nav').getByRole('button', { name: /^我的一天/ })
  await expect(myDayButton).toContainText('1')
  await myDayButton.click()
  await expect(page.getByRole('button', { name: '查看任务 123' })).toBeVisible()
  await page.getByRole('button', { name: '查看任务 123' }).click()
  await page.locator('.detail-pane.is-open').getByRole('button', { name: '我的一天', exact: true }).click()
  await expect(myDayButton).toContainText('0')
  await expect(page.getByRole('button', { name: '查看任务 123' })).toHaveCount(0)
  await page.locator('.sidebar-nav').getByRole('button', { name: /^待办箱/ }).click()
  const noNoteTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 123' }),
  })
  await noNoteTask.getByRole('button', { name: '查看任务 123' }).click()
  const sidebarPaneBox = await page.locator('.sidebar-pane').boundingBox()
  const noNoteTaskBox = await noNoteTask.boundingBox()
  const noNoteStatusBox = await noNoteTask.getByRole('button', { name: '切换任务状态，当前未开始' }).boundingBox()
  const noNoteTitleBox = await noNoteTask.locator('.todo-main strong').boundingBox()
  const noNoteAccentBox = await noNoteTask.locator('.todo-list-accent').boundingBox()
  expect(
    Math.abs(
      (noNoteStatusBox?.y ?? 0) + (noNoteStatusBox?.height ?? 0) / 2 -
        ((noNoteTitleBox?.y ?? 0) + (noNoteTitleBox?.height ?? 0) / 2),
    ),
  ).toBeLessThan(8)
  expect(Math.abs((noNoteAccentBox?.y ?? 0) - (noNoteTaskBox?.y ?? 0))).toBeLessThan(2)
  expect(
    Math.abs(
      (noNoteAccentBox?.y ?? 0) + (noNoteAccentBox?.height ?? 0) - ((noNoteTaskBox?.y ?? 0) + (noNoteTaskBox?.height ?? 0)),
    ),
  ).toBeLessThan(2)
  expect(
    Math.abs((noNoteAccentBox?.x ?? 0) - ((sidebarPaneBox?.x ?? 0) + (sidebarPaneBox?.width ?? 0))),
  ).toBeLessThan(2)
  expect(Math.abs((noNoteAccentBox?.x ?? 0) - (noNoteTaskBox?.x ?? 0))).toBeLessThan(2)

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
  await page.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '明天', exact: true }).click()
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
  await page.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '明天', exact: true }).click()
  await page.locator('.detail-repeat-options').getByRole('button', { name: '每天', exact: true }).click()
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
  await expect(page.locator('.detail-myday-pill.is-auto')).toBeVisible()
  await expect(page.locator('.detail-pane.is-open').getByRole('button', { name: '我的一天', exact: true })).toHaveCount(0)
  await page.locator('.detail-repeat-options').getByRole('button', { name: `每周（${weekdayLabel(today)}）`, exact: true }).click()
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
  await page.locator('.detail-repeat-options').getByRole('button', { name: `每月（${today.getDate()}日）`, exact: true }).click()
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
  const activeAccent = page.locator('.todo-list article.active .todo-list-accent')
  await expect(activeAccent).toHaveCount(1)
  const activeTask = page.locator('.todo-list article.active')
  const activeTaskBox = await activeTask.boundingBox()
  const activeAccentBox = await activeAccent.boundingBox()
  expect(Math.abs((activeAccentBox?.x ?? 0) - (activeTaskBox?.x ?? 0))).toBeLessThan(2)
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

test('phase 4 日程概览：月历展示截止事项并支持在日历中改期', async ({ page, baseURL }) => {
  const passphrase = `phase4-${Date.now()}-pw`

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  const createTask = async (title: string) => {
    await page.getByLabel('快速新建任务').fill(title)
    await page.getByLabel('快速新建任务').press('Enter')
    await expect(page.getByLabel('任务标题')).toHaveValue(title)
  }

  const createTodayTask = async (title: string) => {
    await createTask(title)
    await page.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '今天', exact: true }).click()
    await page.waitForTimeout(500)
  }

  await page.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(page.getByText('匿名会话已建立，可以创建或加入工作区。')).toBeVisible()

  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '调用 workspace-create' }).click()
  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()

  await createTodayTask('月历任务一')
  await createTodayTask('月历已完成')
  await createTodayTask('月历任务三')
  await createTodayTask('月历任务四')

  const completedTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 月历已完成' }),
  })
  await completedTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await completedTask.getByRole('button', { name: '切换任务状态，当前进行中' }).click()
  await expect(
    completedTask.getByRole('button', { name: '切换任务状态，当前已完成' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '日程概览' }).click()
  await expect(page.getByRole('heading', { name: '日程概览' })).toHaveCount(0)
  await expect(page.locator('.calendar-grid')).toBeVisible()
  await expect(page.locator('.calendar-grid').getByText('月历任务一')).toBeVisible()
  await expect(page.locator('.calendar-grid').getByText('月历任务三')).toBeVisible()
  await expect(page.locator('.calendar-grid').getByText('月历任务四')).toBeVisible()
  await expect(page.locator('.detail-pane.is-open')).toHaveCount(0)

  const monthTrigger = page.getByRole('button', { name: /选择年月，当前/ })
  await expect(monthTrigger).toContainText('3月')
  await monthTrigger.click()
  const monthPicker = page.getByRole('dialog', { name: '选择年月' })
  await expect(monthPicker).toBeVisible()
  await monthPicker.getByRole('button', { name: '上一年' }).click()
  await expect(monthPicker.getByText('2025')).toBeVisible()
  await monthPicker.getByRole('button', { name: '3月' }).click()
  await expect(monthTrigger).toContainText('2025年 3月')
  await page.getByRole('button', { name: '回到今天' }).click()
  await expect(monthTrigger).toContainText('2026年 3月')

  const overflowButton = page.getByRole('button', { name: /查看 .*剩余 1 项任务/ })
  await expect(overflowButton).toBeVisible()

  const targetCell = page.locator('.calendar-cell').filter({ has: overflowButton })
  const cellBox = await targetCell.boundingBox()
  expect(cellBox).not.toBeNull()
  await page.mouse.click((cellBox?.x ?? 0) + 18, (cellBox?.y ?? 0) + 18)

  const dayPopover = page.locator('.calendar-day-popover')
  await expect(dayPopover).toBeVisible()
  await expect(dayPopover.getByText('月历已完成')).toBeVisible()
  await expect(dayPopover.locator('.calendar-item.status-completed .calendar-item-title')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )

  await page.keyboard.press('Escape')
  await expect(page.locator('.calendar-day-popover')).toHaveCount(0)

  await overflowButton.click()
  await expect(dayPopover).toBeVisible()
  await monthTrigger.click()
  await expect(page.locator('.calendar-day-popover')).toHaveCount(0)
  await expect(monthPicker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(monthPicker).toHaveCount(0)

  await overflowButton.click()
  await expect(dayPopover).toBeVisible()
  await page.getByRole('button', { name: '关闭当天任务浮层' }).click()
  await expect(page.locator('.calendar-day-popover')).toHaveCount(0)

  await overflowButton.click()
  await dayPopover.getByText('月历已完成').click()
  await expect(page.getByLabel('任务标题')).toHaveValue('月历已完成')
  await expect(page.locator('.detail-pane.is-open')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.locator('.detail-pane.is-open')).toHaveCount(0)

  await page.locator('.calendar-grid').getByText('月历任务一').click()
  await expect(page.getByLabel('任务标题')).toHaveValue('月历任务一')
  await expect(page.locator('.detail-pane.is-open')).toHaveCount(1)
  await page.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '明天', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '关闭详情' }).click()

  await expect(page.locator('.detail-pane.is-open')).toHaveCount(0)
  await expect(page.locator('.calendar-grid').getByText('月历任务一')).toBeVisible()
})

test('phase 4 移动端壳层：抽屉、底部详情与纵向看板', async ({ page, baseURL }) => {
  const passphrase = `phase4-mobile-${Date.now()}-pw`
  const categoryName = '移动分类'
  const taskTitle = '移动任务演示'
  const mobileViewport = { width: 390, height: 844 }

  await page.goto(baseURL!)
  await page.setViewportSize(mobileViewport)

  const drawerToggle = page.locator('.mobile-toolbar-button')
  const mobileDetailSheet = page.locator('.mobile-detail-sheet')

  await page.getByRole('button', { name: '匿名登录并检查 Supabase' }).click()
  await expect(page.getByText('匿名会话已建立，可以创建或加入工作区。')).toBeVisible()

  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '调用 workspace-create' }).click()

  await expect(page.locator('.mobile-board-toolbar')).toBeVisible()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')

  await drawerToggle.click()
  await expect(page.locator('.mobile-sidebar-shell')).toBeVisible()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.click(mobileViewport.width - 12, mobileViewport.height / 2)
  await expect(page.locator('.mobile-sidebar-shell')).toHaveCount(0)
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')

  await drawerToggle.click()
  await expect(page.locator('.mobile-sidebar-shell')).toBeVisible()
  await page.getByRole('button', { name: '新建分类' }).click()
  await page.getByPlaceholder('分类名称').fill(categoryName)
  await page.getByRole('button', { name: '添加分类' }).click()
  await expect(page.getByRole('button', { name: categoryName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: categoryName, exact: true }).click()
  await expect(page.locator('.mobile-sidebar-shell')).toHaveCount(0)
  await expect(page.locator('.mobile-board-toolbar-copy h1')).toHaveText(categoryName)

  await page.getByLabel('快速新建任务').fill(taskTitle)
  await page.getByLabel('快速新建任务').press('Enter')
  await expect(mobileDetailSheet).toBeVisible()
  await expect(mobileDetailSheet.getByLabel('任务标题')).toHaveValue(taskTitle)
  await mobileDetailSheet.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '今天', exact: true }).click()
  await page.waitForTimeout(500)
  await page.locator('.mobile-detail-close').click()
  await expect(mobileDetailSheet).toHaveCount(0)

  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: `查看任务 ${taskTitle}` }).click()
  await expect(mobileDetailSheet).toBeVisible()
  await expect(mobileDetailSheet.getByLabel('任务标题')).toHaveValue(taskTitle)
  await page.keyboard.press('Escape')
  await expect(mobileDetailSheet).toHaveCount(0)

  await drawerToggle.click()
  await page.getByRole('button', { name: '日程概览' }).click()
  await expect(page.locator('.mobile-sidebar-shell')).toHaveCount(0)
  await expect(page.locator('.calendar-grid')).toBeVisible()
  await page.locator('.calendar-grid').getByText(taskTitle).click()
  await expect(mobileDetailSheet).toBeVisible()
  await expect(mobileDetailSheet.getByLabel('任务标题')).toHaveValue(taskTitle)
  await page.mouse.click(mobileViewport.width / 2, 40)
  await expect(mobileDetailSheet).toHaveCount(0)

  await drawerToggle.click()
  await page.getByRole('button', { name: '看板' }).click()
  await expect(page.locator('.mobile-sidebar-shell')).toHaveCount(0)
  await expect(page.locator('.mobile-detail-sheet')).toHaveCount(0)
  await expect(page.locator('.status-column')).toHaveCount(3)

  const firstColumnBox = await page.locator('.status-column').nth(0).boundingBox()
  const secondColumnBox = await page.locator('.status-column').nth(1).boundingBox()
  expect(secondColumnBox).not.toBeNull()
  expect((secondColumnBox?.y ?? 0) - (firstColumnBox?.y ?? 0)).toBeGreaterThan(40)

  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})
