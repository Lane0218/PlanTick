import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Circle,
  Inbox,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import {
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
import type { CategoryRecord, TodoRecord, TodoRecurrenceType, TodoStatus } from './lib/types'
import { enqueueRecordMutation } from './lib/sync'
import { ensureAnonymousSession, invokeWorkspaceFunction } from './lib/supabase'

type WorkspaceMode = 'create' | 'join'
type TaskFilter = 'all' | 'today' | 'overdue' | 'completed'

type TodoDraft = {
  title: string
  categoryId: string
  dueDate: string
  status: TodoStatus
  note: string
  recurrenceType: TodoRecurrenceType
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const categoryPalette = ['#2F6EA4', '#4D7A67', '#C25E4E', '#8B5FD6', '#B36A1D', '#0E7C86']

const filterLabels: Record<TaskFilter, string> = {
  all: '全部任务',
  today: '今天',
  overdue: '逾期',
  completed: '已完成',
}

const todoStatusMeta: Record<TodoStatus, { label: string; tone: string; accent: string }> = {
  not_started: {
    label: '未开始',
    tone: '#90A4AE',
    accent: '#F5F7FA',
  },
  in_progress: {
    label: '进行中',
    tone: '#42A5F5',
    accent: '#EBF5FF',
  },
  completed: {
    label: '已完成',
    tone: '#26A69A',
    accent: '#E8F5F3',
  },
  blocked: {
    label: '阻塞',
    tone: '#EF5350',
    accent: '#FFEBEE',
  },
  canceled: {
    label: '取消',
    tone: '#90A4AE',
    accent: '#F5F7FA',
  },
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
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0)

  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [quickTodoTitle, setQuickTodoTitle] = useState('')
  const [quickDueDate, setQuickDueDate] = useState('')
  const [showQuickCreateDatePicker, setShowQuickCreateDatePicker] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState(categoryPalette[0])
  const [categoryEditorName, setCategoryEditorName] = useState('')
  const [categoryEditorColor, setCategoryEditorColor] = useState(categoryPalette[0])
  const [detailDraft, setDetailDraft] = useState<TodoDraft | null>(null)
  const [confirmDeleteTodo, setConfirmDeleteTodo] = useState(false)
  const lastSavedDraftRef = useRef('')

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
            return todo.status !== 'completed' && todo.dueDate === todayDate()
          case 'overdue':
            return todo.status !== 'completed' && Boolean(todo.dueDate) && todo.dueDate! < todayDate()
          case 'completed':
            return todo.status === 'completed'
          default:
            return true
        }
      }),
    [activeFilter, activeTodos, selectedCategoryId],
  )

  const selectedTodo = activeTodos.find((todo) => todo.id === selectedTodoId) ?? null

  const sidebarCounts = useMemo(
    () => ({
      all: activeTodos.length,
      today: activeTodos.filter(
        (todo) => todo.dueDate === todayDate() && todo.status !== 'completed',
      ).length,
      overdue: activeTodos.filter(
        (todo) => todo.status !== 'completed' && Boolean(todo.dueDate) && todo.dueDate! < todayDate(),
      ).length,
      completed: activeTodos.filter((todo) => todo.status === 'completed').length,
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
      lastSavedDraftRef.current = ''
      setConfirmDeleteTodo(false)
      return
    }

    const nextDraft = {
      title: selectedTodo.title,
      categoryId: selectedTodo.categoryId ?? '',
      dueDate: selectedTodo.dueDate ?? '',
      status: selectedTodo.status,
      note: selectedTodo.note,
      recurrenceType: selectedTodo.recurrenceType,
    }

    setDetailDraft(nextDraft)
    setConfirmDeleteTodo(false)
    lastSavedDraftRef.current = serializeTodoDraft(nextDraft)
  }, [selectedTodo])

  const persistTodoDraft = useEffectEvent(async (draft: TodoDraft, baseTodo: TodoRecord) => {
    if (!workspaceId || !draft.title.trim()) {
      return
    }

    const updated: TodoRecord = {
      ...baseTodo,
      title: draft.title.trim(),
      categoryId: draft.categoryId || null,
      dueDate: draft.dueDate || null,
      status: draft.status,
      note: draft.note,
      recurrenceType: draft.recurrenceType,
      completed: draft.status === 'completed',
      updatedAt: new Date().toISOString(),
    }

    await upsertTodo(updated)
    await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
    lastSavedDraftRef.current = serializeTodoDraft({
      title: updated.title,
      categoryId: updated.categoryId ?? '',
      dueDate: updated.dueDate ?? '',
      status: updated.status,
      note: updated.note,
      recurrenceType: updated.recurrenceType,
    })
    setTodos((current) => current.map((todo) => (todo.id === updated.id ? updated : todo)))
  })

  useEffect(() => {
    if (!selectedTodo || !detailDraft) {
      return
    }

    const nextSignature = serializeTodoDraft(detailDraft)
    if (nextSignature === lastSavedDraftRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistTodoDraft(detailDraft, selectedTodo)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [detailDraft, selectedTodo])

  async function refreshWorkspaceData(nextWorkspaceId?: string) {
    const resolvedWorkspaceId = nextWorkspaceId ?? (await loadWorkspaceId())
    if (!resolvedWorkspaceId) {
      setWorkspaceId('')
      setCategories([])
      setTodos([])
      setPendingOutboxCount(0)
      setSelectedTodoId(null)
      return
    }

    const [workspaceMeta, nextCategories, nextTodos, outbox] = await Promise.all([
      getCurrentWorkspaceMeta(),
      listCategories(resolvedWorkspaceId),
      listTodos(resolvedWorkspaceId),
      listPendingOutbox(resolvedWorkspaceId),
    ])

    setWorkspaceId(resolvedWorkspaceId)
    setCategories(nextCategories)
    setTodos(nextTodos)
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

  async function handleDeleteCategory(categoryOverride?: CategoryRecord) {
    const targetCategory = categoryOverride ?? selectedCategory

    if (!workspaceId || !targetCategory) {
      return
    }

    if (!window.confirm(`确认删除分类「${targetCategory.name}」吗？关联任务会回到未分类。`)) {
      return
    }

    const timestamp = new Date().toISOString()
    const affectedTodos = activeTodos
      .filter((todo) => todo.categoryId === targetCategory.id)
      .map((todo) => ({
        ...todo,
        categoryId: null,
        updatedAt: timestamp,
      }))

    const deletedCategory: CategoryRecord = {
      ...targetCategory,
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
      setMessage(`分类「${targetCategory.name}」已删除，关联任务已回到未分类。`)
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
      quickDueDate || (activeFilter === 'today' ? todayDate() : null),
    )

    setBusy(true)
    try {
      await upsertTodo(record)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(record))
      await refreshWorkspaceData(workspaceId)
      setQuickTodoTitle('')
      setQuickDueDate('')
      setShowQuickCreateDatePicker(false)
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

    const hasUnsavedSelectedDraft =
      selectedTodoId === todo.id &&
      detailDraft &&
      serializeTodoDraft(detailDraft) !== lastSavedDraftRef.current

    const baseTodo: TodoRecord =
      hasUnsavedSelectedDraft && detailDraft
        ? {
            ...todo,
            title: detailDraft.title.trim() || todo.title,
            categoryId: detailDraft.categoryId || null,
            dueDate: detailDraft.dueDate || null,
            note: detailDraft.note,
            recurrenceType: detailDraft.recurrenceType,
          }
        : todo

    const nextStatus = toggleTodoStatus(baseTodo.status)
    const updated: TodoRecord = {
      ...baseTodo,
      status: nextStatus,
      completed: nextStatus === 'completed',
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      await upsertTodo(updated)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
      lastSavedDraftRef.current = serializeTodoDraft({
        title: updated.title,
        categoryId: updated.categoryId ?? '',
        dueDate: updated.dueDate ?? '',
        status: updated.status,
        note: updated.note,
        recurrenceType: updated.recurrenceType,
      })
      await refreshWorkspaceData(workspaceId)
      setMessage(`任务「${todo.title}」状态已切换为 ${todoStatusMeta[updated.status].label}。`)
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

  const boardTitle = selectedCategory ? selectedCategory.name : filterLabels[activeFilter]

  return (
    <main className={shellClassName}>
      <Sidebar
        sessionLabel={sessionLabel}
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
          <div className="board-heading">
            <div className="board-title-row">
              <h1>{boardTitle}</h1>
              {location.pathname !== '/calendar' ? (
                <span className="board-count">{String(visibleTodos.length).padStart(2, '0')}</span>
              ) : null}
            </div>
          </div>

          <div className="board-actions">
            <nav className="route-switch" aria-label="主导航">
              <NavLink to="/todos">任务</NavLink>
              <NavLink to="/calendar">月历</NavLink>
            </nav>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          <Route
            path="/todos"
            element={
              <TodoBoard
                quickTodoTitle={quickTodoTitle}
                setQuickTodoTitle={setQuickTodoTitle}
                quickDueDate={quickDueDate}
                setQuickDueDate={setQuickDueDate}
                showQuickCreateDatePicker={showQuickCreateDatePicker}
                setShowQuickCreateDatePicker={setShowQuickCreateDatePicker}
                handleQuickCreateTodo={handleQuickCreateTodo}
                visibleTodos={visibleTodos}
                selectedTodoId={selectedTodoId}
                setSelectedTodoId={setSelectedTodoId}
                categories={activeCategories}
                handleToggleTodo={handleToggleTodo}
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <CalendarBoard
                categories={activeCategories.length}
                todos={activeTodos.filter((todo) => todo.status !== 'completed').length}
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
          handleDeleteTodo={handleDeleteTodo}
          confirmDeleteTodo={confirmDeleteTodo}
          setConfirmDeleteTodo={setConfirmDeleteTodo}
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
        <h1>先连上工作区，再进入高密度任务工作台。</h1>
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
            <strong>本地优先 + 按需展开详情</strong>
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
                  placeholder="至少 6 个字符…"
                  minLength={6}
                  name="workspacePassphrase"
                  autoComplete="off"
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
          <p>成功接入后默认进入任务页，桌面端先聚焦主列表，选中任务时再展开详情。</p>
        </aside>
      </section>
    </main>
  )
}

function Sidebar({
  sessionLabel,
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
  sessionLabel: string
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
  handleDeleteCategory: (category?: CategoryRecord) => Promise<void>
  busy: boolean
}) {
  const [categoryDialogMode, setCategoryDialogMode] = useState<'create' | 'edit' | null>(null)
  const [menuCategoryId, setMenuCategoryId] = useState<string | null>(null)

  const dialogTitle = categoryDialogMode === 'edit' ? '修改分类' : '新建分类'

  const openCreateDialog = () => {
    setMenuCategoryId(null)
    setCategoryDialogMode('create')
  }

  const openEditDialog = (category: CategoryRecord) => {
    setSelectedCategoryId(category.id)
    setActiveFilter('all')
    setMenuCategoryId(null)
    setCategoryDialogMode('edit')
  }

  const closeCategoryDialog = () => {
    setCategoryDialogMode(null)
    setMenuCategoryId(null)
  }

  const handleCategoryDialogSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (categoryDialogMode === 'edit') {
      await handleSaveCategory()
      if (selectedCategory && categoryEditorName.trim()) {
        closeCategoryDialog()
      }
      return
    }

    await handleCreateCategory(event)
    if (newCategoryName.trim()) {
      closeCategoryDialog()
    }
  }

  return (
    <aside className="sidebar-pane">
      <div className="sidebar-brandbar">
        <div className="sidebar-brandmark" aria-hidden="true">
          <Inbox size={18} strokeWidth={2.2} />
        </div>
        <div className="sidebar-brandcopy">
          <h2 title={sessionLabel}>PlanTick</h2>
        </div>
      </div>

      <nav className="sidebar-section sidebar-nav" aria-label="任务筛选">
        {(Object.keys(filterLabels) as TaskFilter[]).map((filter) => (
          <button
            key={filter}
            className={activeFilter === filter && !selectedCategoryId ? 'sidebar-item active' : 'sidebar-item'}
            onClick={() => {
              setSelectedCategoryId(null)
              setActiveFilter(filter)
            }}
          >
            <span className="sidebar-item-main">
              <span className={`sidebar-icon sidebar-icon-${filter}`} aria-hidden="true" />
              <span>{filterLabels[filter]}</span>
            </span>
            <b>{sidebarCounts[filter]}</b>
          </button>
        ))}
      </nav>

      <section className="sidebar-section sidebar-card sidebar-category-section">
        <div className="section-head">
          <div>
            <span>我的列表</span>
          </div>
          <button
            type="button"
            className={categoryDialogMode === 'create' ? 'sidebar-plain-button active' : 'sidebar-plain-button'}
            aria-label="新建分类"
            onClick={openCreateDialog}
          >
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <div className="category-list">
          {categories.map((category) => (
            <div
              key={category.id}
              className={selectedCategoryId === category.id ? 'category-row active' : 'category-row'}
            >
              <button
                className={selectedCategoryId === category.id ? 'category-item active' : 'category-item'}
                onClick={() => {
                  setSelectedCategoryId(category.id)
                  setActiveFilter('all')
                }}
              >
                <span className="color-dot" style={{ backgroundColor: category.color }} />
                <span className="category-name">{category.name}</span>
              </button>

              <button
                type="button"
                className="category-more"
                aria-label={`分类操作 ${category.name}`}
                onClick={() => {
                  setMenuCategoryId((current) => (current === category.id ? null : category.id))
                }}
              >
                <MoreHorizontal size={16} strokeWidth={2.1} aria-hidden="true" />
              </button>

              {menuCategoryId === category.id ? (
                <div className="category-menu" role="menu" aria-label={`${category.name} 分类操作`}>
                  <button type="button" role="menuitem" onClick={() => openEditDialog(category)}>
                    修改分类
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setSelectedCategoryId(category.id)
                      setActiveFilter('all')
                      setMenuCategoryId(null)
                      void handleDeleteCategory(category)
                    }}
                  >
                    删除分类
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {categoryDialogMode ? (
        <div className="category-dialog-backdrop" role="presentation" onClick={closeCategoryDialog}>
          <div
            className="category-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="category-dialog-head">
              <h3 id="category-dialog-title">{dialogTitle}</h3>
              <button type="button" className="detail-close" aria-label="关闭分类对话框" onClick={closeCategoryDialog}>
                ×
              </button>
            </div>

            <form className="category-dialog-form" onSubmit={(event) => void handleCategoryDialogSubmit(event)}>
              <label>
                <span>{categoryDialogMode === 'edit' ? '分类名称' : '新分类'}</span>
                <input
                  value={categoryDialogMode === 'edit' ? categoryEditorName : newCategoryName}
                  onChange={(event) =>
                    categoryDialogMode === 'edit'
                      ? setCategoryEditorName(event.target.value)
                      : setNewCategoryName(event.target.value)
                  }
                  placeholder="例如：工作、生活、学习…"
                  name={categoryDialogMode === 'edit' ? 'categoryEditorName' : 'newCategoryName'}
                  autoComplete="off"
                />
              </label>

              <div className="palette-row" aria-label="分类颜色">
                {categoryPalette.map((color) => {
                  const activeColor = categoryDialogMode === 'edit' ? categoryEditorColor : newCategoryColor

                  return (
                    <button
                      key={color}
                      type="button"
                      className={activeColor === color ? 'palette-chip active' : 'palette-chip'}
                      style={{ backgroundColor: color }}
                      aria-label={`颜色 ${color}`}
                      onClick={() =>
                        categoryDialogMode === 'edit'
                          ? setCategoryEditorColor(color)
                          : setNewCategoryColor(color)
                      }
                    />
                  )
                })}
              </div>

              <div className="category-dialog-actions">
                <button className="secondary-button" type="button" onClick={closeCategoryDialog}>
                  取消
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    busy ||
                    !(categoryDialogMode === 'edit' ? categoryEditorName.trim() : newCategoryName.trim())
                  }
                >
                  {categoryDialogMode === 'edit' ? '保存分类' : '添加分类'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function TodoBoard({
  quickTodoTitle,
  setQuickTodoTitle,
  quickDueDate,
  setQuickDueDate,
  showQuickCreateDatePicker,
  setShowQuickCreateDatePicker,
  handleQuickCreateTodo,
  visibleTodos,
  selectedTodoId,
  setSelectedTodoId,
  categories,
  handleToggleTodo,
}: {
  quickTodoTitle: string
  setQuickTodoTitle: (value: string) => void
  quickDueDate: string
  setQuickDueDate: (value: string) => void
  showQuickCreateDatePicker: boolean
  setShowQuickCreateDatePicker: (value: boolean) => void
  handleQuickCreateTodo: (event: FormEvent<HTMLFormElement>) => Promise<void>
  visibleTodos: TodoRecord[]
  selectedTodoId: string | null
  setSelectedTodoId: (id: string | null) => void
  categories: CategoryRecord[]
  handleToggleTodo: (todo: TodoRecord) => Promise<void>
}) {
  return (
    <section className="todo-board">
      <form className="quick-create" onSubmit={(event) => void handleQuickCreateTodo(event)}>
        <div className="quick-create-shell">
          <span className="quick-create-icon" aria-hidden="true">
            +
          </span>
          <input
            value={quickTodoTitle}
            onChange={(event) => setQuickTodoTitle(event.target.value)}
            placeholder="添加任务"
            aria-label="快速新建任务"
            name="quickTodoTitle"
            autoComplete="off"
          />
          <div className="quick-date-popover">
            <button
              type="button"
              className={showQuickCreateDatePicker ? 'quick-date-toggle active' : 'quick-date-toggle'}
              aria-expanded={showQuickCreateDatePicker}
              onClick={() => setShowQuickCreateDatePicker(!showQuickCreateDatePicker)}
            >
              {quickDueDate ? formatDueDate(quickDueDate, 'not_started').label : '选择日期'}
            </button>

            {showQuickCreateDatePicker ? (
              <div className="quick-create-options">
                <div className="quick-create-shortcuts" aria-label="新建任务日期快捷方式">
                  <button
                    type="button"
                    className={quickDueDate === todayDate() ? 'ghost-button active' : 'ghost-button'}
                    onClick={() => setQuickDueDate(todayDate())}
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    className={quickDueDate === nextDate(1) ? 'ghost-button active' : 'ghost-button'}
                    onClick={() => setQuickDueDate(nextDate(1))}
                  >
                    明天
                  </button>
                  <button
                    type="button"
                    className={!quickDueDate ? 'ghost-button active' : 'ghost-button'}
                    onClick={() => setQuickDueDate('')}
                  >
                    无日期
                  </button>
                </div>

                <label className="quick-date-picker">
                  <span className="sr-only">新建任务日期</span>
                  <input
                    type="date"
                    value={quickDueDate}
                    onChange={(event) => setQuickDueDate(event.target.value)}
                    aria-label="新建任务日期"
                    name="quickTodoDueDate"
                  />
                </label>

                <button className="primary-button quick-create-submit" type="submit">
                  添加任务
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </form>

      {visibleTodos.length ? (
        <div className="todo-list" role="list">
          {visibleTodos.map((todo) => {
            const category = categories.find((item) => item.id === todo.categoryId) ?? null
            const statusMeta = todoStatusMeta[todo.status]
            const dueLabel = formatDueDate(todo.dueDate, todo.status)
            const noteExcerpt = todo.note.trim().split('\n')[0]

            return (
              <article
                key={todo.id}
                className={[
                  'todo-card',
                  `status-${todo.status}`,
                  selectedTodoId === todo.id ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid={`todo-item-${todo.id}`}
                style={
                  {
                    '--todo-tone': statusMeta.tone,
                    '--todo-accent': statusMeta.accent,
                    '--todo-category-tone': category?.color ?? '#cfd6db',
                  } as CSSProperties
                }
              >
                <span className="todo-list-accent" aria-hidden="true" />

                <button
                  type="button"
                  className={`todo-status-trigger todo-status-${todo.status}`}
                  aria-label={`切换任务状态，当前${statusMeta.label}`}
                  onClick={() => void handleToggleTodo(todo)}
                >
                  <span className="todo-status-icon" aria-hidden="true">
                    {renderStatusIcon(todo.status)}
                  </span>
                </button>

                <button
                  type="button"
                  className="todo-main"
                  aria-label={`查看任务 ${todo.title}`}
                  onClick={() => setSelectedTodoId(todo.id)}
                >
                  <div className="todo-row">
                    <strong>{todo.title}</strong>
                    {dueLabel.label ? (
                      <span className={dueLabel.emphasis ? 'todo-due is-alert' : 'todo-due'}>
                        {dueLabel.label}
                      </span>
                    ) : null}
                  </div>

                  {noteExcerpt ? <p className="todo-excerpt">{noteExcerpt}</p> : null}
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h2>这里还没有任务。</h2>
          <p>从上方输入框开始添加第一条任务。</p>
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
  handleDeleteTodo,
  confirmDeleteTodo,
  setConfirmDeleteTodo,
  closeDetail,
  busy,
}: {
  selectedTodo: TodoRecord | null
  categories: CategoryRecord[]
  detailDraft: TodoDraft | null
  setDetailDraft: (draft: TodoDraft | null) => void
  handleDeleteTodo: () => Promise<void>
  confirmDeleteTodo: boolean
  setConfirmDeleteTodo: (value: boolean) => void
  closeDetail: () => void
  busy: boolean
}) {
  const selectedCategory = categories.find((category) => category.id === detailDraft?.categoryId) ?? null
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)

  return (
    <aside className={selectedTodo ? 'detail-pane is-open' : 'detail-pane'} aria-label="任务详情">
      {selectedTodo && detailDraft ? (
        <>
          <div className="detail-head">
            <div className="detail-list-picker">
              <button
                type="button"
                className="detail-list-select"
                aria-haspopup="listbox"
                aria-expanded={showCategoryPicker}
                onClick={() => setShowCategoryPicker((current) => !current)}
              >
                <span className="detail-list-name">
                  <span
                    className="detail-list-dot"
                    style={{ backgroundColor: selectedCategory?.color ?? '#90A4AE' }}
                    aria-hidden="true"
                  />
                  <span>{selectedCategory?.name ?? '未分类'}</span>
                </span>
                <ChevronDown size={14} strokeWidth={2.2} className="detail-list-arrow" aria-hidden="true" />
              </button>

              {showCategoryPicker ? (
                <div className="detail-list-menu" role="listbox" aria-label="分类列表">
                  <button
                    type="button"
                    className={!detailDraft.categoryId ? 'active' : ''}
                    onClick={() => {
                      setDetailDraft({
                        ...detailDraft,
                        categoryId: '',
                      })
                      setShowCategoryPicker(false)
                    }}
                  >
                    <span className="detail-list-dot neutral" aria-hidden="true" />
                    <span>未分类</span>
                  </button>
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={detailDraft.categoryId === category.id ? 'active' : ''}
                      onClick={() => {
                        setDetailDraft({
                          ...detailDraft,
                          categoryId: category.id,
                        })
                        setShowCategoryPicker(false)
                      }}
                    >
                      <span
                        className="detail-list-dot"
                        style={{ backgroundColor: category.color }}
                        aria-hidden="true"
                      />
                      <span>{category.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="detail-close"
              onClick={() => {
                setShowCategoryPicker(false)
                closeDetail()
              }}
              aria-label="关闭详情"
            >
              ×
            </button>
          </div>

          <input
            className="detail-title-input"
            value={detailDraft.title}
            onChange={(event) =>
              setDetailDraft({
                ...detailDraft,
                title: event.target.value,
              })
            }
            placeholder="任务标题…"
            aria-label="任务标题"
            name="detailTitle"
            autoComplete="off"
          />

          <div className="detail-scroll">
            <div className="detail-stack">
              <section className="detail-section detail-date-block">
                <div className="detail-card-head">
                  <span>日期</span>
                </div>
                <div className="detail-date-shortcuts">
                  <button
                    type="button"
                    className={detailDraft.dueDate === todayDate() ? 'ghost-button active' : 'ghost-button'}
                    onClick={() =>
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: todayDate(),
                      })
                    }
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    className={detailDraft.dueDate === nextDate(1) ? 'ghost-button active' : 'ghost-button'}
                    onClick={() =>
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: nextDate(1),
                      })
                    }
                  >
                    明天
                  </button>
                  <button
                    type="button"
                    className={!detailDraft.dueDate ? 'ghost-button active' : 'ghost-button'}
                    onClick={() =>
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: '',
                      })
                    }
                  >
                    无日期
                  </button>
                </div>

                <label className="detail-field detail-date-picker">
                  <span>日期</span>
                  <input
                    type="date"
                    value={detailDraft.dueDate}
                    onChange={(event) =>
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: event.target.value,
                      })
                    }
                    aria-label="日期"
                    name="detailDueDate"
                  />
                </label>
              </section>

              <section className="detail-section detail-note-section">
                <div className="detail-card-head">
                  <span>描述</span>
                </div>
                <label className="detail-field detail-note-field">
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
                    placeholder="添加描述..."
                    aria-label="备注"
                    name="detailNote"
                    autoComplete="off"
                  />
                </label>
              </section>
            </div>
          </div>

          <div className="detail-footer">
            {confirmDeleteTodo ? (
              <>
                <p className="detail-footer-hint">确认删除这条任务？</p>
                <div className="detail-footer-actions">
                  <button className="secondary-button" onClick={() => setConfirmDeleteTodo(false)} type="button">
                    取消
                  </button>
                  <button className="danger-button" onClick={() => void handleDeleteTodo()} disabled={busy} type="button">
                    删除
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="detail-footer-actions">
                  <button className="detail-footer-link" type="button" disabled>
                    <Repeat size={15} strokeWidth={2.1} />
                    <span>重复</span>
                  </button>
                  <button
                    className="detail-footer-link is-danger"
                    onClick={() => setConfirmDeleteTodo(true)}
                    disabled={busy}
                    type="button"
                  >
                    <Trash2 size={15} strokeWidth={2.1} />
                    <span>删除</span>
                  </button>
                </div>
                <button className="detail-footer-icon" type="button" disabled aria-label="更多操作">
                  <MoreHorizontal size={16} strokeWidth={2.1} />
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="detail-empty">
          <h2>点击一条任务，右侧就会展开详情。</h2>
          <p>这里会承接标题、分类、日期、备注和删除操作。</p>
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
  if (left.status === 'completed' && right.status !== 'completed') {
    return 1
  }

  if (left.status !== 'completed' && right.status === 'completed') {
    return -1
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
    status: 'not_started',
    completed: false,
    note: '',
    recurrenceType: 'none',
    updatedAt: now,
    deleted: false,
  }
}

function formatDueDate(value: string | null, status: TodoStatus) {
  if (!value) {
    return {
      label: '',
      emphasis: false,
    }
  }

  const diff = diffDaysFromToday(value)

  if (diff === -2) {
    return {
      label: '前天',
      emphasis: status !== 'completed',
    }
  }

  if (diff === -1) {
    return {
      label: '昨天',
      emphasis: status !== 'completed',
    }
  }

  if (diff === 0) {
    return {
      label: '今天',
      emphasis: status !== 'completed',
    }
  }

  if (diff === 1) {
    return {
      label: '明天',
      emphasis: false,
    }
  }

  if (diff === 2) {
    return {
      label: '后天',
      emphasis: false,
    }
  }

  if (diff < 0 && status !== 'completed') {
    return {
      label: formatMonthDay(value),
      emphasis: true,
    }
  }

  return {
    label: formatMonthDay(value),
    emphasis: false,
  }
}

function formatMonthDay(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function toggleTodoStatus(status: TodoStatus): TodoStatus {
  return nextTodoStatus(status)
}

function nextTodoStatus(status: TodoStatus): TodoStatus {
  const cycle: TodoStatus[] = ['not_started', 'in_progress', 'blocked', 'completed', 'canceled']
  const currentIndex = cycle.indexOf(status)
  return cycle[(currentIndex + 1) % cycle.length]
}

function nextDate(days: number) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return next.toISOString().slice(0, 10)
}

function diffDaysFromToday(value: string) {
  const current = new Date(`${todayDate()}T00:00:00`).getTime()
  const target = new Date(`${value}T00:00:00`).getTime()
  return Math.round((target - current) / 86400000)
}

function renderStatusIcon(status: TodoStatus) {
  switch (status) {
    case 'in_progress':
      return <PlayCircle size={15} strokeWidth={2} />
    case 'completed':
      return <CheckCircle2 size={15} strokeWidth={2} />
    case 'blocked':
      return <PauseCircle size={15} strokeWidth={2} />
    case 'canceled':
      return <Ban size={15} strokeWidth={2} />
    default:
      return <Circle size={15} strokeWidth={2} />
  }
}

function serializeTodoDraft(draft: TodoDraft) {
  return JSON.stringify([
    draft.title.trim(),
    draft.categoryId,
    draft.dueDate,
    draft.status,
    draft.note,
    draft.recurrenceType,
  ])
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
    status: record.status,
    completed: record.completed,
    note: record.note,
    recurrence_type: record.recurrenceType === 'none' ? null : record.recurrenceType,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

export default App
