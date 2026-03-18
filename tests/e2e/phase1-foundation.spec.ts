import { expect, test, type Page } from '@playwright/test'

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

function getSyncActionButton(page: Page) {
  return page.getByRole('button', {
    name: /^(立即同步|读取同步状态中|正在推送本地变更|正在拉取最新数据|同步异常)/,
  })
}

function getWorkspaceSettingsButton(page: Page) {
  return page.getByRole('button', { name: '打开工作区设置' })
}

async function expectWorkspaceAccessDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: '创建或加入你的任务工作台' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '创建工作区' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '加入工作区' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '游客模式' })).toBeVisible()
  await expect(dialog.getByLabel('工作区口令')).toBeVisible()
  await expect(dialog.getByText('接入工作区')).toHaveCount(0)
  await expect(dialog.getByRole('heading', { name: 'PWA 安装' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '返回' })).toHaveCount(0)
}

async function createWorkspaceFromDialog(page: Page, passphrase: string) {
  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '创建工作区' }).click()
  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '创建并进入工作台' }).click()
  await expect(page.getByRole('dialog', { name: '创建或加入你的任务工作台' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建分类' })).toBeVisible()
}

async function joinWorkspaceFromDialog(page: Page, passphrase: string) {
  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '加入工作区' }).click()
  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '加入并进入工作台' }).click()
  await expect(page.getByRole('dialog', { name: '创建或加入你的任务工作台' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建分类' })).toBeVisible()
}

async function seedWorkspaceSyncError(page: Page, lastError: string) {
  await page.evaluate(async (message) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('plantick-app')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const transaction = database.transaction(['workspace_meta', 'sync_meta'], 'readwrite')
    const workspaceMeta = await new Promise<{ workspaceId?: string } | undefined>((resolve, reject) => {
      const request = transaction.objectStore('workspace_meta').get('current')
      request.onsuccess = () => resolve(request.result as { workspaceId?: string } | undefined)
      request.onerror = () => reject(request.error)
    })

    if (!workspaceMeta?.workspaceId) {
      throw new Error('缺少当前工作区。')
    }

    transaction.objectStore('sync_meta').put({
      workspaceId: workspaceMeta.workspaceId,
      status: 'error',
      lastPushAt: null,
      lastPullAt: null,
      lastError: message,
      cursor: {
        categories: { updatedAt: null },
        todos: { updatedAt: null },
        events: { updatedAt: null },
      },
    })

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })

    database.close()
  }, lastError)
}

test('phase 2 首次进入直接展示工作台并支持游客模式', async ({ page, baseURL }) => {
  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()
  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '创建工作区' }).click()
  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '游客模式' }).click()
  await expect(page.getByRole('dialog', { name: '创建或加入你的任务工作台' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()
  await expect(page.getByRole('button', { name: '创建工作区' })).toBeVisible()
  await expect(page.getByRole('button', { name: '加入工作区' })).toBeVisible()

  await expect(page.getByRole('status')).toContainText('游客模式')
  await expect(page.getByRole('button', { name: '查看任务 整理今天的优先事项' })).toBeVisible()
  await expect(getSyncActionButton(page)).toHaveCount(0)
  await expect(getWorkspaceSettingsButton(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看任务 补完上周遗留的发布检查' })).toBeVisible()
  await expect(page.getByLabel('快速新建任务')).toBeEnabled()
  await expect(page.getByText('点开一条任务，右侧会展示示例详情。')).toHaveCount(0)

  await page.getByRole('button', { name: '查看任务 整理今天的优先事项' }).click()
  await expect(page.getByLabel('任务标题')).toHaveValue('整理今天的优先事项')
  await expect(page.getByText('未开始')).toBeVisible()
  await expect(page.getByText('进行中')).toBeVisible()
  await expect(page.getByText('已完成')).toBeVisible()
  await expect(page.getByText('阻塞')).toBeVisible()
  await expect(page.getByText('取消')).toBeVisible()
  const guestDetailPane = page.getByLabel('任务详情')
  await expect(guestDetailPane.getByRole('button', { name: '工作', exact: true })).toBeVisible()
  await expect(guestDetailPane.getByRole('button', { name: '生活', exact: true })).toBeVisible()
  await expect(guestDetailPane.getByRole('button', { name: '学习', exact: true })).toBeVisible()
  await page.getByLabel('备注').fill('游客模式下也可以编辑任务详情')

  await page.getByRole('button', { name: '新建分类' }).click()
  await page.getByPlaceholder('分类名称').fill('游客分类')
  await page.getByRole('button', { name: '添加分类' }).click()
  await expect(page.getByRole('button', { name: '游客分类', exact: true })).toBeVisible()

  await page.getByLabel('快速新建任务').fill('游客模式新任务')
  await page.getByLabel('快速新建任务').press('Enter')
  await expect(page.getByLabel('任务标题')).toHaveValue('游客模式新任务')
  await page.getByLabel('备注').fill('仅保存在本次会话')

  const guestTask = page.locator('article', {
    has: page.getByRole('button', { name: '查看任务 游客模式新任务' }),
  })
  await guestTask.getByRole('button', { name: '切换任务状态，当前未开始' }).click()
  await expect(guestTask.getByRole('button', { name: '切换任务状态，当前进行中' })).toBeVisible()

  await page.getByRole('button', { name: '看板' }).click()
  await expect(page.getByLabel('状态看板')).toBeVisible()
  await expect(page.getByText('补完上周遗留的发布检查')).toBeVisible()
  await expect(page.getByText('游客模式新任务')).toBeVisible()

  await page.getByRole('button', { name: '日程概览' }).click()
  await expect(page.locator('.calendar-grid')).toBeVisible()
  await expect(page.locator('.calendar-grid').getByText('整理今天的优先事项')).toBeVisible()
  await expect(page.locator('.calendar-grid').getByText('产品评审会')).toBeVisible()
  await page.getByLabel('快速新建事件').fill('游客事件')
  await page.getByRole('button', { name: '新建事件' }).click()
  await expect(page.locator('.calendar-grid').getByText('游客事件')).toBeVisible()

  await page.reload()
  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '游客模式' }).click()
  await expect(page.getByRole('button', { name: '查看任务 整理今天的优先事项' })).toBeVisible()
  await expect(page.getByRole('button', { name: '游客分类', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看任务 游客模式新任务' })).toHaveCount(0)
  await page.getByRole('button', { name: '日程概览' }).click()
  await expect(page.locator('.calendar-grid').getByText('游客事件')).toHaveCount(0)

  await page.getByRole('button', { name: '创建工作区' }).click()
  await expect(page.getByRole('dialog', { name: '创建或加入你的任务工作台' })).toBeVisible()
  await expect(page.getByLabel('工作区口令')).toBeVisible()
})

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

  await createWorkspaceFromDialog(page, passphrase)
  await expect(page.getByRole('heading', { name: '待办箱' })).toBeVisible()
  await expect(page.locator('.sidebar-nav .sidebar-icon svg')).toHaveCount(5)
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
  await expect(restoredTask.getByRole('button', { name: /切换任务状态，当前/ })).toBeVisible()
  await expect(restoredTask.getByText('明天')).toBeVisible()
})

test('phase 3 工作区设置：支持修改口令并退出当前工作区', async ({ page, baseURL }) => {
  const oldPassphrase = `phase3-settings-old-${Date.now()}`
  const newPassphrase = `phase3-settings-new-${Date.now()}`

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  await createWorkspaceFromDialog(page, oldPassphrase)

  await getWorkspaceSettingsButton(page).click()
  const settingsDialog = page.getByRole('dialog', { name: '工作区设置' })
  await expect(settingsDialog).toBeVisible()
  await expect(settingsDialog.getByText('当前工作区')).toHaveCount(0)
  await expect(settingsDialog.getByText('配置工作区')).toBeVisible()
  await expect(settingsDialog.getByText('工作区 ID')).toBeVisible()
  await expect(settingsDialog.getByText('设备会话')).toHaveCount(0)
  await expect(settingsDialog.getByText('加入时间')).toHaveCount(0)
  await expect(settingsDialog.getByText('最近活跃')).toHaveCount(0)
  await expect(settingsDialog.getByText('创建时间')).toHaveCount(0)
  await expect(settingsDialog.getByText('同步状态')).toHaveCount(0)
  await expect(settingsDialog.getByText('更新后，新设备需使用新口令加入。')).toHaveCount(0)

  await settingsDialog.getByRole('textbox', { name: '新口令', exact: true }).fill(newPassphrase)
  await settingsDialog.getByRole('textbox', { name: '确认新口令', exact: true }).fill(newPassphrase)
  await settingsDialog.getByRole('button', { name: '更新口令' }).click()
  await expect(settingsDialog.getByText('工作区口令已更新。')).toBeVisible()

  await settingsDialog.getByRole('button', { name: '退出工作区' }).click()
  await expect(settingsDialog.getByText('退出后将返回工作区入口。')).toBeVisible()
  await settingsDialog.getByRole('button', { name: '确认退出' }).click()

  const accessDialog = page.getByRole('dialog', { name: '创建或加入你的任务工作台' })
  await expect(accessDialog).toBeVisible()
  await expect(accessDialog.getByText('已退出当前工作区。')).toBeVisible()
  await accessDialog.getByRole('button', { name: '加入工作区' }).click()
  await accessDialog.getByLabel('工作区口令').fill(oldPassphrase)
  await accessDialog.getByRole('button', { name: '加入并进入工作台' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid passphrase.')
  await expect(page.getByRole('button', { name: '新建分类' })).toHaveCount(0)

  await accessDialog.getByLabel('工作区口令').fill(newPassphrase)
  await accessDialog.getByRole('button', { name: '加入并进入工作台' }).click()
  await expect(accessDialog).toHaveCount(0)
  await expect(getWorkspaceSettingsButton(page)).toBeVisible()
})

test('phase 3 同步异常通过 toast 展示且同步按钮不再暴露长错误 tooltip', async ({ page, baseURL }) => {
  const passphrase = `phase3-sync-toast-${Date.now()}`

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })
  await createWorkspaceFromDialog(page, passphrase)

  await seedWorkspaceSyncError(
    page,
    "event 同步失败：Could not find the 'all_day' column of 'events' in the schema cache",
  )

  await getWorkspaceSettingsButton(page).click()

  const toast = page.getByRole('alert')
  await expect(toast).toContainText("Could not find the 'all_day' column of 'events' in the schema cache")
  await expect(getSyncActionButton(page)).toHaveAttribute('aria-label', '同步异常')
  await expect(getSyncActionButton(page)).not.toHaveAttribute('title', /Could not find/)

  await toast.getByRole('button', { name: '关闭提示' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
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

  await createWorkspaceFromDialog(page, passphrase)
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
  await expect(page.getByRole('heading', { name: '日程概览' })).toBeVisible()
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

  const overflowButton = page.getByRole('button', { name: /查看 .*剩余 1 项安排/ })
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
  await page.getByRole('button', { name: '关闭当天安排浮层' }).click()
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

test('phase 4 日程概览：同一天内事件排在任务前，全天事件排在定时事件前', async ({ page, baseURL }) => {
  const passphrase = `phase4-calendar-order-${Date.now()}-pw`
  const taskTitle = '同日任务'
  const allDayEventTitle = '全天事件'
  const timedEventTitle = '定时事件'

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  await createWorkspaceFromDialog(page, passphrase)

  await page.getByLabel('快速新建任务').fill(taskTitle)
  await page.getByLabel('快速新建任务').press('Enter')
  await page.locator('.detail-info-card, .detail-section').filter({ hasText: '截止日期' }).first().getByRole('button', { name: '今天', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '关闭详情' }).click()

  await page.getByRole('button', { name: '日程概览' }).click()

  await page.getByLabel('快速新建事件').fill(allDayEventTitle)
  await page.getByLabel('快速新建事件').press('Enter')
  await page.getByRole('button', { name: '关闭详情' }).click()

  await page.getByLabel('快速新建事件').fill(timedEventTitle)
  await page.getByLabel('快速新建事件').press('Enter')
  await page.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true }).click()
  await page.getByLabel('开始时间').fill('10:00')
  await page.getByLabel('结束时间').fill('11:00')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '关闭详情' }).click()

  const orderedTitles = await page
    .locator('.calendar-cell.is-selected .calendar-item .calendar-item-title')
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))

  await expect(page.locator('.calendar-cell.is-selected .calendar-item-time').nth(0)).toHaveText('全天')
  await expect(page.locator('.calendar-cell.is-selected .calendar-item-time').nth(1)).toHaveText('10:00-11:00')
  expect(orderedTitles).toEqual([allDayEventTitle, timedEventTitle, taskTitle])
})

test('phase 4 日程概览：支持事件创建、编辑、刷新恢复与删除', async ({ page, baseURL }) => {
  const passphrase = `phase4-events-${Date.now()}-pw`
  const eventTitle = '评审会议'
  const updatedTitle = '评审会议-调整'

  await page.goto(baseURL!)
  await page.setViewportSize({ width: 1440, height: 960 })

  await createWorkspaceFromDialog(page, passphrase)
  await page.getByRole('button', { name: '日程概览' }).click()

  await page.getByLabel('快速新建事件').fill(eventTitle)
  await page.getByLabel('快速新建事件').press('Enter')

  await expect(page.getByLabel('事件标题')).toHaveValue(eventTitle)
  await expect(page.locator('.calendar-grid').getByText(eventTitle)).toBeVisible()
  await expect(page.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('开始时间')).toBeDisabled()
  await expect(page.getByLabel('结束时间')).toBeDisabled()

  await page.getByLabel('事件标题').fill(updatedTitle)
  await page.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true }).click()
  await page.getByLabel('开始时间').fill('14:00')
  await page.getByLabel('结束时间').fill('15:30')
  await page.getByLabel('事件详情').getByRole('button', { name: '已完成', exact: true }).click()
  await page.getByLabel('事件备注').fill('同步本周发布计划')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '关闭详情' }).click()

  await page.reload()
  await page.getByRole('button', { name: '日程概览' }).click()
  await expect(page.locator('.calendar-grid').getByText(updatedTitle)).toBeVisible()
  await expect(page.locator('.calendar-grid .calendar-item-event.status-completed').getByText(updatedTitle)).toBeVisible()

  await page.locator('.calendar-grid').getByText(updatedTitle).click()
  await expect(page.getByLabel('事件标题')).toHaveValue(updatedTitle)
  await expect(page.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('开始时间')).toHaveValue('14:00')
  await expect(page.getByLabel('结束时间')).toHaveValue('15:30')
  await expect(page.getByLabel('事件详情').getByRole('button', { name: '已完成', exact: true })).toHaveClass(/active/)
  await expect(page.getByLabel('事件备注')).toHaveValue('同步本周发布计划')

  await page.getByRole('button', { name: '删除' }).click()
  await page.locator('.detail-footer-actions').getByRole('button', { name: '删除' }).click()
  await expect(page.locator('.detail-pane.is-open')).toHaveCount(0)
  await expect(page.locator('.calendar-grid').getByText(updatedTitle)).toHaveCount(0)
})

test('phase 4 双设备同步：事件创建、编辑、删除可跨设备补拉可见', async ({ browser, baseURL }) => {
  test.setTimeout(60_000)

  const passphrase = `phase4-cross-device-${Date.now()}-pw`
  const eventTitle = '跨设备评审'
  const updatedTitle = '跨设备评审-调整'
  const viewport = { width: 1440, height: 960 }

  const deviceA = await browser.newContext()
  const deviceB = await browser.newContext()
  const pageA = await deviceA.newPage()
  const pageB = await deviceB.newPage()

  const openCalendar = async (page: Page) => {
    await page.getByRole('button', { name: '日程概览' }).click()
    await expect(page.locator('.calendar-grid')).toBeVisible()
    await expect(getSyncActionButton(page)).toBeVisible()
  }

  try {
    await pageA.goto(baseURL!)
    await pageA.setViewportSize(viewport)
    await createWorkspaceFromDialog(pageA, passphrase)
    await openCalendar(pageA)

    await pageB.goto(baseURL!)
    await pageB.setViewportSize(viewport)
    await joinWorkspaceFromDialog(pageB, passphrase)
    await openCalendar(pageB)

    await pageA.getByLabel('快速新建事件').fill(eventTitle)
    await pageA.getByLabel('快速新建事件').press('Enter')
    await expect(pageA.getByLabel('事件标题')).toHaveValue(eventTitle)
    await expect(pageA.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await getSyncActionButton(pageA).click()
    await getSyncActionButton(pageB).click()
    await expect(pageB.locator('.calendar-grid').getByText(eventTitle)).toBeVisible()

    await pageA.locator('.calendar-grid').getByText(eventTitle).click()
    await pageA.getByLabel('事件标题').fill(updatedTitle)
    await pageA.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true }).click()
    await pageA.getByLabel('开始时间').fill('10:00')
    await pageA.getByLabel('结束时间').fill('11:30')
    await pageA.getByLabel('事件详情').getByRole('button', { name: '已完成', exact: true }).click()
    await pageA.getByLabel('事件备注').fill('双设备编辑验证')
    await pageA.waitForTimeout(1200)

    await getSyncActionButton(pageA).click()
    await getSyncActionButton(pageB).click()
    await pageB.locator('.calendar-grid').getByText(updatedTitle).click()
    await expect(pageB.getByLabel('事件标题')).toHaveValue(updatedTitle)
    await expect(pageB.getByLabel('事件详情').getByRole('button', { name: '全天', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(pageB.getByLabel('开始时间')).toHaveValue('10:00')
    await expect(pageB.getByLabel('结束时间')).toHaveValue('11:30')
    await expect(pageB.getByLabel('事件详情').getByRole('button', { name: '已完成', exact: true })).toHaveClass(/active/)
    await expect(pageB.getByLabel('事件备注')).toHaveValue('双设备编辑验证')
    await pageB.getByRole('button', { name: '关闭详情' }).click()

    await pageA.getByRole('button', { name: '删除' }).click()
    await pageA.locator('.detail-footer-actions').getByRole('button', { name: '删除' }).click()
    await expect(pageA.locator('.detail-pane.is-open')).toHaveCount(0)

    await getSyncActionButton(pageA).click()
    await getSyncActionButton(pageB).click()
    await expect(pageB.locator('.calendar-grid').getByText(updatedTitle)).toHaveCount(0)
  } finally {
    await pageA.close()
    await pageB.close()
    await deviceA.close()
    await deviceB.close()
  }
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

  await expectWorkspaceAccessDialog(page)
  await page.getByRole('dialog', { name: '创建或加入你的任务工作台' }).getByRole('button', { name: '创建工作区' }).click()
  await page.getByPlaceholder('至少 6 个字符…').fill(passphrase)
  await page.getByRole('button', { name: '创建并进入工作台' }).click()
  await expect(page.getByRole('dialog', { name: '创建或加入你的任务工作台' })).toHaveCount(0)

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
