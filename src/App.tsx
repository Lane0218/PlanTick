import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import {
  ensureSyncMeta,
  getCurrentWorkspaceMeta,
  listCategories,
  listPendingOutbox,
  listTodos,
  loadWorkspaceId,
  runIndexedDbProbe,
  saveCurrentWorkspaceMeta,
  saveWorkspaceId,
  upsertCategory,
  upsertTodo,
} from './lib/db'
import { envSummary, isSupabaseConfigured } from './lib/env'
import type { CategoryRecord, TodoRecord, TodoRecurrenceType } from './lib/types'
import { enqueueRecordMutation } from './lib/sync'
import type { SyncMeta } from './lib/sync-types'
import { ensureAnonymousSession, invokeWorkspaceFunction } from './lib/supabase'

type WorkspaceMode = 'create' | 'join'
type TaskFilter = 'all' | 'today' | 'overdue' | 'completed'

type TodoDraft = {
  title: string
  categoryId: string
  dueDate: string
  note: string
  recurrenceType: TodoRecurrenceType
  completed: boolean
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const categoryPalette = ['#4F7A68', '#C86E4F', '#B79A54', '#6989A8', '#A06D8E', '#6E7C88']

const filterLabels: Record<TaskFilter, string> = {
  all: '全部任务',
  today: '今天',
  overdue: '逾期',
  completed: '已完成',
}

declare global {
  interface WindowEventMap {
    'plantick:pwa-ready': CustomEvent<{ registered: boolean }>
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

function App() {
  const location = useLocation()
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('create')
  const [passphrase, setPassphrase] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [sessionLabel, setSessionLabel] = useState('尚未建立匿名会话')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('请选择工作区后开始管理任务。')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [pwaLabel, setPwaLabel] = useState('等待浏览器安装入口')

  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [todos, setTodos] = useState<TodoRecord[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncMeta['status']>('idle')
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0)

  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [quickTodoTitle, setQuickTodoTitle] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState(categoryPalette[0])
  const [categoryEditorName, setCategoryEditorName] = useState('')
  const [categoryEditorColor, setCategoryEditorColor] = useState(categoryPalette[0])
  const [detailDraft, setDetailDraft] = useState<TodoDraft | null>(null)

  const activeCategories = useMemo(
    () =>
      categories
        .filter((category) => !category.deleted)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [categories],
  )

  const activeTodos = useMemo(
    () =>
      todos
        .filter((todo) => !todo.deleted)
        .sort((left, right) => compareTodos(left, right)),
    [todos],
  )

  const selectedCategory =
    activeCategories.find((category) => category.id === selectedCategoryId) ?? null

  const visibleTodos = useMemo(
    () =>
      activeTodos.filter((todo) => {
        if (selectedCategoryId && todo.categoryId !== selectedCategoryId) {
          return false
        }

        switch (activeFilter) {
          case 'today':
            return todo.dueDate === todayDate()
          case 'overdue':
            return !todo.completed && Boolean(todo.dueDate) && todo.dueDate! < todayDate()
          case 'completed':
            return todo.completed
          default:
            return !todo.completed
        }
      }),
    [activeFilter, activeTodos, selectedCategoryId],
  )

  const selectedTodo = activeTodos.find((todo) => todo.id === selectedTodoId) ?? null

  const sidebarCounts = useMemo(
    () => ({
      all: activeTodos.filter((todo) => !todo.completed).length,
      today: activeTodos.filter((todo) => todo.dueDate === todayDate() && !todo.completed).length,
      overdue: activeTodos.filter(
        (todo) => !todo.completed && Boolean(todo.dueDate) && todo.dueDate! < todayDate(),
      ).length,
      completed: activeTodos.filter((todo) => todo.completed).length,
    }),
    [activeTodos],
  )

  useEffect(() => {
    void runIndexedDbProbe().catch(() => undefined)

    const restore = async () => {
      const restoredWorkspaceId = await loadWorkspaceId()
      if (!restoredWorkspaceId) {
        return
      }

      await refreshWorkspaceData(restoredWorkspaceId)
      setMessage(`已恢复最近工作区：${restoredWorkspaceId}`)
    }

    void restore()

    const handlePwaReady = (event: WindowEventMap['plantick:pwa-ready']) => {
      setPwaLabel(event.detail.registered ? 'PWA 已注册' : 'PWA 注册失败')
    }

    const handleBeforeInstallPrompt = (event: WindowEventMap['beforeinstallprompt']) => {
      event.preventDefault()
      setInstallPrompt(event)
      setPwaLabel('浏览器允许安装到桌面')
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setPwaLabel('已安装为 PWA')
    }

    window.addEventListener('plantick:pwa-ready', handlePwaReady)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setPwaLabel('当前以 PWA 独立窗口运行')
    }

    return () => {
      window.removeEventListener('plantick:pwa-ready', handlePwaReady)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    if (!selectedCategory) {
      setCategoryEditorName('')
      setCategoryEditorColor(categoryPalette[0])
      return
    }

    setCategoryEditorName(selectedCategory.name)
    setCategoryEditorColor(selectedCategory.color)
  }, [selectedCategory])

  useEffect(() => {
    if (!selectedTodo) {
      setDetailDraft(null)
      return
    }

    setDetailDraft({
      title: selectedTodo.title,
      categoryId: selectedTodo.categoryId ?? '',
      dueDate: selectedTodo.dueDate ?? '',
      note: selectedTodo.note,
      recurrenceType: selectedTodo.recurrenceType,
      completed: selectedTodo.completed,
    })
  }, [selectedTodo])

  async function refreshWorkspaceData(nextWorkspaceId?: string) {
    const resolvedWorkspaceId = nextWorkspaceId ?? (await loadWorkspaceId())
    if (!resolvedWorkspaceId) {
      setWorkspaceId('')
      setCategories([])
      setTodos([])
      setPendingOutboxCount(0)
      setSyncStatus('idle')
      setSelectedTodoId(null)
      return
    }

    const [workspaceMeta, nextCategories, nextTodos, meta, outbox] = await Promise.all([
      getCurrentWorkspaceMeta(),
      listCategories(resolvedWorkspaceId),
      listTodos(resolvedWorkspaceId),
      ensureSyncMeta(resolvedWorkspaceId),
      listPendingOutbox(resolvedWorkspaceId),
    ])

    setWorkspaceId(resolvedWorkspaceId)
    setCategories(nextCategories)
    setTodos(nextTodos)
    setSyncStatus(meta.status)
    setPendingOutboxCount(outbox.length)
    setSessionLabel(
      workspaceMeta?.anonymousUserId
        ? `设备会话 ${workspaceMeta.anonymousUserId.slice(0, 8)}`
        : '尚未建立匿名会话',
    )

    setSelectedCategoryId((current) =>
      current && nextCategories.some((category) => category.id === current && !category.deleted)
        ? current
        : null,
    )
    setSelectedTodoId((current) =>
      current && nextTodos.some((todo) => todo.id === current && !todo.deleted) ? current : null,
    )
  }

  async function handleAnonymousSignIn() {
    if (!isSupabaseConfigured) {
      setMessage('缺少 Supabase 环境变量，当前无法建立匿名会话。')
      return
    }

    setBusy(true)
    try {
      const session = await ensureAnonymousSession()
      setSessionLabel(`设备会话 ${session.user.id.slice(0, 8)}`)
      setMessage('匿名会话已建立，可以创建或加入工作区。')

      if (workspaceId) {
        await saveCurrentWorkspaceMeta(workspaceId, session.user.id)
        await refreshWorkspaceData(workspaceId)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '匿名登录失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleWorkspaceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (passphrase.trim().length < 6) {
      setMessage('工作区口令至少需要 6 个字符。')
      return
    }

    setBusy(true)
    try {
      const session = await ensureAnonymousSession()
      const response = await invokeWorkspaceFunction(workspaceMode, passphrase.trim())

      await saveWorkspaceId(response.workspaceId)
      await saveCurrentWorkspaceMeta(response.workspaceId, session.user.id)
      await refreshWorkspaceData(response.workspaceId)

      setMessage(
        `${workspaceMode === 'create' ? '创建' : '加入'}工作区成功，已进入任务工作台。`,
      )
      setPassphrase('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '工作区操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleInstall() {
    if (!installPrompt) {
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setPwaLabel(choice.outcome === 'accepted' ? '用户接受安装提示' : '用户关闭安装提示')
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId || !newCategoryName.trim()) {
      return
    }

    const record: CategoryRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      name: newCategoryName.trim(),
      color: newCategoryColor,
      updatedAt: new Date().toISOString(),
      deleted: false,
    }

    setBusy(true)
    try {
      await upsertCategory(record)
      await enqueueRecordMutation('categories', 'upsert', toSyncCategory(record))
      await refreshWorkspaceData(workspaceId)
      setSelectedCategoryId(record.id)
      setActiveFilter('all')
      setNewCategoryName('')
      setNewCategoryColor(categoryPalette[(activeCategories.length + 1) % categoryPalette.length])
      setMessage(`分类「${record.name}」已创建。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveCategory() {
    if (!workspaceId || !selectedCategory || !categoryEditorName.trim()) {
      return
    }

    const updated: CategoryRecord = {
      ...selectedCategory,
      name: categoryEditorName.trim(),
      color: categoryEditorColor,
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      await upsertCategory(updated)
      await enqueueRecordMutation('categories', 'upsert', toSyncCategory(updated))
      await refreshWorkspaceData(workspaceId)
      setMessage(`分类「${updated.name}」已更新。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteCategory() {
    if (!workspaceId || !selectedCategory) {
      return
    }

    const timestamp = new Date().toISOString()
    const affectedTodos = activeTodos
      .filter((todo) => todo.categoryId === selectedCategory.id)
      .map((todo) => ({
        ...todo,
        categoryId: null,
        updatedAt: timestamp,
      }))

    const deletedCategory: CategoryRecord = {
      ...selectedCategory,
      deleted: true,
      updatedAt: timestamp,
    }

    setBusy(true)
    try {
      await Promise.all(affectedTodos.map((todo) => upsertTodo(todo)))
      await Promise.all(
        affectedTodos.map((todo) => enqueueRecordMutation('todos', 'upsert', toSyncTodo(todo))),
      )

      await upsertCategory(deletedCategory)
      await enqueueRecordMutation('categories', 'soft-delete', toSyncCategory(deletedCategory))

      await refreshWorkspaceData(workspaceId)
      setSelectedCategoryId(null)
      setMessage(`分类「${selectedCategory.name}」已删除，关联任务已回到未分类。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleQuickCreateTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId || !quickTodoTitle.trim()) {
      return
    }

    const record = createTodoRecord(
      workspaceId,
      quickTodoTitle.trim(),
      selectedCategoryId,
      activeFilter === 'today' ? todayDate() : null,
    )

    setBusy(true)
    try {
      await upsertTodo(record)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(record))
      await refreshWorkspaceData(workspaceId)
      setQuickTodoTitle('')
      setSelectedTodoId(record.id)
      setMessage(`任务「${record.title}」已创建。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleTodo(todo: TodoRecord) {
    if (!workspaceId) {
      return
    }

    const updated: TodoRecord = {
      ...todo,
      completed: !todo.completed,
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      await upsertTodo(updated)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
      await refreshWorkspaceData(workspaceId)
      setMessage(updated.completed ? `任务「${todo.title}」已完成。` : `任务「${todo.title}」已恢复。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveTodo() {
    if (!workspaceId || !selectedTodo || !detailDraft?.title.trim()) {
      setMessage('任务标题不能为空。')
      return
    }

    const updated: TodoRecord = {
      ...selectedTodo,
      title: detailDraft.title.trim(),
      categoryId: detailDraft.categoryId || null,
      dueDate: detailDraft.dueDate || null,
      note: detailDraft.note.trim(),
      recurrenceType: detailDraft.recurrenceType,
      completed: detailDraft.completed,
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      await upsertTodo(updated)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
      await refreshWorkspaceData(workspaceId)
      setMessage(`任务「${updated.title}」已保存。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteTodo() {
    if (!workspaceId || !selectedTodo) {
      return
    }

    const deletedTodo: TodoRecord = {
      ...selectedTodo,
      deleted: true,
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      await upsertTodo(deletedTodo)
      await enqueueRecordMutation('todos', 'soft-delete', toSyncTodo(deletedTodo))
      await refreshWorkspaceData(workspaceId)
      setSelectedTodoId(null)
      setMessage(`任务「${selectedTodo.title}」已删除。`)
    } finally {
      setBusy(false)
    }
  }

  const shellClassName = [
    'workspace-shell',
    selectedTodoId && location.pathname !== '/calendar' ? 'has-detail' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!workspaceId) {
    return (
      <OnboardingLayout
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        handleAnonymousSignIn={handleAnonymousSignIn}
        handleWorkspaceSubmit={handleWorkspaceSubmit}
        handleInstall={handleInstall}
        busy={busy}
        message={message}
        installPrompt={installPrompt}
        pwaLabel={pwaLabel}
      />
    )
  }

  return (
    <main className={shellClassName}>
      <Sidebar
        workspaceId={workspaceId}
        sessionLabel={sessionLabel}
        syncStatus={syncStatus}
        pendingOutboxCount={pendingOutboxCount}
        envSummary={envSummary}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        sidebarCounts={sidebarCounts}
        categories={activeCategories}
        newCategoryName={newCategoryName}
        setNewCategoryName={setNewCategoryName}
        newCategoryColor={newCategoryColor}
        setNewCategoryColor={setNewCategoryColor}
        handleCreateCategory={handleCreateCategory}
        selectedCategory={selectedCategory}
        categoryEditorName={categoryEditorName}
        setCategoryEditorName={setCategoryEditorName}
        categoryEditorColor={categoryEditorColor}
        setCategoryEditorColor={setCategoryEditorColor}
        handleSaveCategory={handleSaveCategory}
        handleDeleteCategory={handleDeleteCategory}
        busy={busy}
      />

      <section className="board-pane">
        <header className="board-header">
          <div>
            <p className="eyebrow">PlanTick / Phase 3</p>
            <h1>{selectedCategory ? selectedCategory.name : filterLabels[activeFilter]}</h1>
            <p className="board-subtitle">
              单用户本地优先任务工作台，右侧详情可展开也可关闭。
            </p>
          </div>

          <div className="board-actions">
            <nav className="route-switch" aria-label="主导航">
              <NavLink to="/todos">任务</NavLink>
              <NavLink to="/calendar">月历</NavLink>
            </nav>

            <button
              className="install-chip"
              onClick={() => void handleInstall()}
              disabled={!installPrompt}
            >
              {installPrompt ? '安装 PWA' : pwaLabel}
            </button>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          <Route
            path="/todos"
            element={
              <TodoBoard
                busy={busy}
                activeFilter={activeFilter}
                setActiveFilter={setActiveFilter}
                selectedCategory={selectedCategory}
                quickTodoTitle={quickTodoTitle}
                setQuickTodoTitle={setQuickTodoTitle}
                handleQuickCreateTodo={handleQuickCreateTodo}
                visibleTodos={visibleTodos}
                selectedTodoId={selectedTodoId}
                setSelectedTodoId={setSelectedTodoId}
                categories={activeCategories}
                handleToggleTodo={handleToggleTodo}
                message={message}
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <CalendarBoard
                categories={activeCategories.length}
                todos={activeTodos.filter((todo) => !todo.completed).length}
                pendingOutboxCount={pendingOutboxCount}
              />
            }
          />
        </Routes>
      </section>

      {location.pathname !== '/calendar' ? (
        <TodoDetailPane
          selectedTodo={selectedTodo}
          categories={activeCategories}
          detailDraft={detailDraft}
          setDetailDraft={setDetailDraft}
          handleToggleTodo={handleToggleTodo}
          handleSaveTodo={handleSaveTodo}
          handleDeleteTodo={handleDeleteTodo}
          closeDetail={() => setSelectedTodoId(null)}
          busy={busy}
        />
      ) : null}
    </main>
  )
}

function OnboardingLayout({
  workspaceMode,
  setWorkspaceMode,
  passphrase,
  setPassphrase,
  handleAnonymousSignIn,
  handleWorkspaceSubmit,
  handleInstall,
  busy,
  message,
  installPrompt,
  pwaLabel,
}: {
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  passphrase: string
  setPassphrase: (value: string) => void
  handleAnonymousSignIn: () => Promise<void>
  handleWorkspaceSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleInstall: () => Promise<void>
  busy: boolean
  message: string
  installPrompt: BeforeInstallPromptEvent | null
  pwaLabel: string
}) {
  return (
    <main className="onboarding-shell">
      <section className="onboarding-copy">
        <p className="eyebrow">PlanTick</p>
        <h1>先连上工作区，再进入三栏任务工作台。</h1>
        <p>
          Phase 3 不再是验证壳。当前入口只保留工作区接入、匿名会话和 PWA 安装能力，
          真正的任务管理会在接入成功后展开。
        </p>

        <div className="onboarding-metrics">
          <div>
            <span>模式</span>
            <strong>{envSummary}</strong>
          </div>
          <div>
            <span>PWA</span>
            <strong>{pwaLabel}</strong>
          </div>
          <div>
            <span>架构</span>
            <strong>本地优先 + 三栏任务台</strong>
          </div>
        </div>
      </section>

      <section className="onboarding-panel">
        <div className="panel-stack">
          <article className="setup-card">
            <div className="setup-head">
              <p>Step A</p>
              <h2>匿名会话</h2>
            </div>
            <p className="setup-body">
              匿名会话只用于工作区接入和后续受限 API 调用，不暴露为注册登录流程。
            </p>
            <button className="primary-button" onClick={() => void handleAnonymousSignIn()} disabled={busy}>
              {busy ? '处理中...' : '匿名登录并检查 Supabase'}
            </button>
          </article>

          <article className="setup-card">
            <div className="setup-head">
              <p>Step B</p>
              <h2>创建或加入工作区</h2>
            </div>

            <form className="workspace-form" onSubmit={handleWorkspaceSubmit}>
              <div className="segmented">
                <button
                  type="button"
                  className={workspaceMode === 'create' ? 'active' : ''}
                  onClick={() => setWorkspaceMode('create')}
                >
                  创建工作区
                </button>
                <button
                  type="button"
                  className={workspaceMode === 'join' ? 'active' : ''}
                  onClick={() => setWorkspaceMode('join')}
                >
                  加入口令工作区
                </button>
              </div>

              <label>
                <span>工作区口令</span>
                <input
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder="至少 6 个字符"
                  minLength={6}
                />
              </label>

              <button className="secondary-button" type="submit" disabled={busy || !isSupabaseConfigured}>
                {busy
                  ? '提交中...'
                  : workspaceMode === 'create'
                    ? '调用 workspace-create'
                    : '调用 workspace-join'}
              </button>
            </form>
          </article>

          <article className="setup-card compact">
            <div className="setup-head">
              <p>Step C</p>
              <h2>PWA 安装</h2>
            </div>
            <button className="ghost-button" onClick={() => void handleInstall()} disabled={!installPrompt}>
              {installPrompt ? '安装到桌面' : pwaLabel}
            </button>
          </article>
        </div>

        <aside className="setup-status" aria-live="polite">
          <p className="eyebrow">当前状态</p>
          <h2>{message}</h2>
          <p>成功接入后默认进入任务页，桌面端显示三栏，移动端切换为单栏列表和底部详情抽屉。</p>
        </aside>
      </section>
    </main>
  )
}

function Sidebar({
  workspaceId,
  sessionLabel,
  syncStatus,
  pendingOutboxCount,
  envSummary,
  activeFilter,
  setActiveFilter,
  selectedCategoryId,
  setSelectedCategoryId,
  sidebarCounts,
  categories,
  newCategoryName,
  setNewCategoryName,
  newCategoryColor,
  setNewCategoryColor,
  handleCreateCategory,
  selectedCategory,
  categoryEditorName,
  setCategoryEditorName,
  categoryEditorColor,
  setCategoryEditorColor,
  handleSaveCategory,
  handleDeleteCategory,
  busy,
}: {
  workspaceId: string
  sessionLabel: string
  syncStatus: SyncMeta['status']
  pendingOutboxCount: number
  envSummary: string
  activeFilter: TaskFilter
  setActiveFilter: (filter: TaskFilter) => void
  selectedCategoryId: string | null
  setSelectedCategoryId: (id: string | null) => void
  sidebarCounts: Record<TaskFilter, number>
  categories: CategoryRecord[]
  newCategoryName: string
  setNewCategoryName: (value: string) => void
  newCategoryColor: string
  setNewCategoryColor: (value: string) => void
  handleCreateCategory: (event: FormEvent<HTMLFormElement>) => Promise<void>
  selectedCategory: CategoryRecord | null
  categoryEditorName: string
  setCategoryEditorName: (value: string) => void
  categoryEditorColor: string
  setCategoryEditorColor: (value: string) => void
  handleSaveCategory: () => Promise<void>
  handleDeleteCategory: () => Promise<void>
  busy: boolean
}) {
  return (
    <aside className="sidebar-pane">
      <div className="sidebar-top">
        <p className="eyebrow">Workspace</p>
        <h2>PlanTick</h2>
        <p className="workspace-token">{workspaceId}</p>
      </div>

      <nav className="sidebar-section" aria-label="任务筛选">
        {(Object.keys(filterLabels) as TaskFilter[]).map((filter) => (
          <button
            key={filter}
            className={activeFilter === filter && !selectedCategoryId ? 'sidebar-item active' : 'sidebar-item'}
            onClick={() => {
              setSelectedCategoryId(null)
              setActiveFilter(filter)
            }}
          >
            <span>{filterLabels[filter]}</span>
            <b>{sidebarCounts[filter]}</b>
          </button>
        ))}
      </nav>

      <section className="sidebar-section">
        <div className="section-head">
          <p>分类</p>
          <span>{categories.length}</span>
        </div>

        <div className="category-list">
          {categories.map((category) => (
            <button
              key={category.id}
              className={selectedCategoryId === category.id ? 'category-item active' : 'category-item'}
              onClick={() => {
                setSelectedCategoryId(category.id)
                setActiveFilter('all')
              }}
            >
              <span className="color-dot" style={{ backgroundColor: category.color }} />
              <span>{category.name}</span>
            </button>
          ))}
        </div>

        <form className="category-create" onSubmit={(event) => void handleCreateCategory(event)}>
          <label>
            <span>新分类</span>
            <input
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="例如：工作、生活、学习"
            />
          </label>

          <div className="category-toolbar">
            <div className="palette-row" aria-label="分类颜色">
              {categoryPalette.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={newCategoryColor === color ? 'palette-chip active' : 'palette-chip'}
                  style={{ backgroundColor: color }}
                  aria-label={`颜色 ${color}`}
                  onClick={() => setNewCategoryColor(color)}
                />
              ))}
            </div>

            <button
              className="secondary-button"
              type="submit"
              disabled={busy || !newCategoryName.trim()}
            >
              新建分类
            </button>
          </div>
        </form>

        {selectedCategory ? (
          <div className="category-editor">
            <div className="section-head">
              <p>分类设置</p>
              <span>已选中</span>
            </div>

            <label>
              <span>名称</span>
              <input
                value={categoryEditorName}
                onChange={(event) => setCategoryEditorName(event.target.value)}
              />
            </label>

            <div className="palette-row" aria-label="编辑分类颜色">
              {categoryPalette.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={categoryEditorColor === color ? 'palette-chip active' : 'palette-chip'}
                  style={{ backgroundColor: color }}
                  aria-label={`编辑颜色 ${color}`}
                  onClick={() => setCategoryEditorColor(color)}
                />
              ))}
            </div>

            <div className="editor-actions">
              <button className="secondary-button" onClick={() => void handleSaveCategory()} disabled={busy}>
                保存分类
              </button>
              <button className="danger-button" onClick={() => void handleDeleteCategory()} disabled={busy}>
                删除分类
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <footer className="sidebar-footer">
        <div>
          <span>设备会话</span>
          <strong>{sessionLabel}</strong>
        </div>
        <div>
          <span>同步状态</span>
          <strong>
            {syncStatus} · 待同步 {pendingOutboxCount}
          </strong>
        </div>
        <div>
          <span>环境</span>
          <strong>{envSummary}</strong>
        </div>
      </footer>
    </aside>
  )
}

function TodoBoard({
  busy,
  activeFilter,
  setActiveFilter,
  selectedCategory,
  quickTodoTitle,
  setQuickTodoTitle,
  handleQuickCreateTodo,
  visibleTodos,
  selectedTodoId,
  setSelectedTodoId,
  categories,
  handleToggleTodo,
  message,
}: {
  busy: boolean
  activeFilter: TaskFilter
  setActiveFilter: (filter: TaskFilter) => void
  selectedCategory: CategoryRecord | null
  quickTodoTitle: string
  setQuickTodoTitle: (value: string) => void
  handleQuickCreateTodo: (event: FormEvent<HTMLFormElement>) => Promise<void>
  visibleTodos: TodoRecord[]
  selectedTodoId: string | null
  setSelectedTodoId: (id: string | null) => void
  categories: CategoryRecord[]
  handleToggleTodo: (todo: TodoRecord) => Promise<void>
  message: string
}) {
  return (
    <section className="todo-board">
      <div className="board-toolbar">
        <form className="quick-create" onSubmit={(event) => void handleQuickCreateTodo(event)}>
          <input
            value={quickTodoTitle}
            onChange={(event) => setQuickTodoTitle(event.target.value)}
            placeholder="快速新建任务，例如：整理待办详情面板"
            aria-label="快速新建任务"
          />
          <button className="primary-button" type="submit" disabled={busy || !quickTodoTitle.trim()}>
            新建任务
          </button>
        </form>

        <div className="filter-tabs" role="tablist" aria-label="任务筛选">
          {(['all', 'today', 'overdue', 'completed'] as TaskFilter[]).map((filter) => (
            <button
              key={filter}
              className={activeFilter === filter && !selectedCategory ? 'active' : ''}
              onClick={() => setActiveFilter(filter)}
            >
              {filterLabels[filter]}
            </button>
          ))}
        </div>
      </div>

      <div className="list-summary">
        <p>{selectedCategory ? `当前分类：${selectedCategory.name}` : filterLabels[activeFilter]}</p>
        <span>{visibleTodos.length} 条任务</span>
      </div>

      {visibleTodos.length ? (
        <div className="todo-list" role="list">
          {visibleTodos.map((todo) => {
            const category = categories.find((item) => item.id === todo.categoryId) ?? null

            return (
              <article
                key={todo.id}
                className={selectedTodoId === todo.id ? 'todo-card active' : 'todo-card'}
                data-testid={`todo-item-${todo.id}`}
              >
                <button
                  type="button"
                  className={todo.completed ? 'checkmark is-complete' : 'checkmark'}
                  aria-label={todo.completed ? '恢复任务' : '完成任务'}
                  onClick={() => void handleToggleTodo(todo)}
                />

                <button
                  type="button"
                  className="todo-main"
                  aria-label={`查看任务 ${todo.title}`}
                  onClick={() => setSelectedTodoId(todo.id)}
                >
                  <div className="todo-line">
                    <strong>{todo.title}</strong>
                    {category ? (
                      <span className="todo-badge" style={{ color: category.color }}>
                        {category.name}
                      </span>
                    ) : (
                      <span className="todo-badge muted">未分类</span>
                    )}
                  </div>

                  <div className="todo-meta">
                    <span>{todo.note ? truncate(todo.note, 42) : '点击右侧详情补充备注、重复规则和截止日期'}</span>
                    <span>{formatDueDate(todo.dueDate, todo.completed)}</span>
                  </div>
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state">
          <p className="eyebrow">No Tasks</p>
          <h2>这里还没有任务。</h2>
          <p>{message}</p>
        </div>
      )}
    </section>
  )
}

function TodoDetailPane({
  selectedTodo,
  categories,
  detailDraft,
  setDetailDraft,
  handleToggleTodo,
  handleSaveTodo,
  handleDeleteTodo,
  closeDetail,
  busy,
}: {
  selectedTodo: TodoRecord | null
  categories: CategoryRecord[]
  detailDraft: TodoDraft | null
  setDetailDraft: (draft: TodoDraft | null) => void
  handleToggleTodo: (todo: TodoRecord) => Promise<void>
  handleSaveTodo: () => Promise<void>
  handleDeleteTodo: () => Promise<void>
  closeDetail: () => void
  busy: boolean
}) {
  return (
    <aside className={selectedTodo ? 'detail-pane is-open' : 'detail-pane'} aria-label="任务详情">
      {selectedTodo && detailDraft ? (
        <>
          <div className="detail-head">
            <div>
              <p className="eyebrow">Task Detail</p>
              <h2>{selectedTodo.title}</h2>
            </div>
            <button className="icon-button" onClick={closeDetail} aria-label="关闭详情">
              关闭
            </button>
          </div>

          <div className="detail-stack">
            <label>
              <span>标题</span>
              <input
                value={detailDraft.title}
                onChange={(event) =>
                  setDetailDraft({
                    ...detailDraft,
                    title: event.target.value,
                  })
                }
                placeholder="任务标题"
              />
            </label>

            <div className="detail-split">
              <label>
                <span>分类</span>
                <select
                  value={detailDraft.categoryId}
                  onChange={(event) =>
                    setDetailDraft({
                      ...detailDraft,
                      categoryId: event.target.value,
                    })
                  }
                >
                  <option value="">未分类</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>截止日期</span>
                <input
                  type="date"
                  value={detailDraft.dueDate}
                  onChange={(event) =>
                    setDetailDraft({
                      ...detailDraft,
                      dueDate: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <label>
              <span>重复规则</span>
              <select
                value={detailDraft.recurrenceType}
                onChange={(event) =>
                  setDetailDraft({
                    ...detailDraft,
                    recurrenceType: event.target.value as TodoRecurrenceType,
                  })
                }
              >
                <option value="none">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
            </label>

            <label>
              <span>备注</span>
              <textarea
                value={detailDraft.note}
                onChange={(event) =>
                  setDetailDraft({
                    ...detailDraft,
                    note: event.target.value,
                  })
                }
                rows={8}
                placeholder="记录上下文、拆分步骤或补充说明"
              />
            </label>

            <div className="detail-meta">
              <button
                className={selectedTodo.completed ? 'secondary-button active' : 'secondary-button'}
                onClick={() => void handleToggleTodo(selectedTodo)}
                disabled={busy}
              >
                {selectedTodo.completed ? '恢复未完成' : '标记完成'}
              </button>
              <span>更新时间 {formatTimestamp(selectedTodo.updatedAt)}</span>
            </div>
          </div>

          <div className="detail-actions">
            <button className="primary-button" onClick={() => void handleSaveTodo()} disabled={busy}>
              保存更改
            </button>
            <button className="danger-button" onClick={() => void handleDeleteTodo()} disabled={busy}>
              删除任务
            </button>
          </div>
        </>
      ) : (
        <div className="detail-empty">
          <p className="eyebrow">Detail</p>
          <h2>点击一条任务，右侧就会展开详情。</h2>
          <p>这里会承接标题、分类、截止日期、备注和重复规则的编辑。</p>
        </div>
      )}
    </aside>
  )
}

function CalendarBoard({
  categories,
  todos,
  pendingOutboxCount,
}: {
  categories: number
  todos: number
  pendingOutboxCount: number
}) {
  return (
    <section className="calendar-board">
      <div className="calendar-hero">
        <p className="eyebrow">Calendar Route</p>
        <h2>月历页面保留同一套壳，但业务仍在下一阶段接入。</h2>
        <p>
          当前先统一视觉基线，避免后续再从展示页迁移。待办与分类会继续作为 Phase 3 的主线，
          月历页在 Phase 4 承接日程投影和日期格布局。
        </p>
      </div>

      <div className="calendar-metrics">
        <div>
          <span>分类</span>
          <strong>{categories}</strong>
        </div>
        <div>
          <span>未完成任务</span>
          <strong>{todos}</strong>
        </div>
        <div>
          <span>待同步 outbox</span>
          <strong>{pendingOutboxCount}</strong>
        </div>
      </div>
    </section>
  )
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function compareTodos(left: TodoRecord, right: TodoRecord) {
  if (left.completed !== right.completed) {
    return left.completed ? 1 : -1
  }

  if (left.dueDate && right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate)
  }

  if (left.dueDate) {
    return -1
  }

  if (right.dueDate) {
    return 1
  }

  return right.updatedAt.localeCompare(left.updatedAt)
}

function createTodoRecord(
  workspaceId: string,
  title: string,
  categoryId: string | null,
  dueDate: string | null,
): TodoRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    title,
    categoryId,
    dueDate,
    completed: false,
    note: '',
    recurrenceType: 'none',
    updatedAt: now,
    deleted: false,
  }
}

function formatDueDate(value: string | null, completed: boolean) {
  if (!value) {
    return completed ? '已完成 · 无截止日期' : '未设置截止日期'
  }

  if (value === todayDate()) {
    return completed ? '今天完成' : '今天截止'
  }

  if (value < todayDate() && !completed) {
    return `${value} · 已逾期`
  }

  return value
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function toSyncCategory(record: CategoryRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    color: record.color,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

function toSyncTodo(record: TodoRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    title: record.title,
    category_id: record.categoryId,
    due_date: record.dueDate,
    completed: record.completed,
    note: record.note,
    recurrence_type: record.recurrenceType === 'none' ? null : record.recurrenceType,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

export default App
