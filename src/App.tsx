import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import {
  Ban,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Inbox,
  LogOut,
  Menu,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  SquareKanban,
  Sun,
  Trash2,
  X,
  GripVertical,
} from 'lucide-react'
import { zhCN } from 'date-fns/locale'
import './App.css'
import {
  clearCurrentWorkspaceMeta,
  getCurrentWorkspaceMeta,
  listCategories,
  listEvents,
  listPendingOutbox,
  listTodos,
  loadWorkspaceId,
  readSyncMeta,
  runIndexedDbProbe,
  saveCurrentWorkspaceMeta,
  saveWorkspaceId,
  upsertCategory,
  upsertEvent,
  upsertTodo,
} from './lib/db'
import { isSupabaseConfigured } from './lib/env'
import type {
  CategoryRecord,
  EventRecord,
  EventStatus,
  TodoRecord,
  TodoRecurrenceType,
  TodoStatus,
  WorkspaceSettingsInfo,
} from './lib/types'
import { enqueueRecordMutation, pullRemoteChanges, pushPendingOperations, reconcileRemoteChanges } from './lib/sync'
import type { SyncStatus as WorkspaceSyncStatus } from './lib/sync-types'
import {
  ensureAnonymousSession,
  invokeWorkspaceFunction,
  updateWorkspacePassphrase,
} from './lib/supabase'

type WorkspaceMode = 'create' | 'join'
type WorkspaceView = 'todos' | 'board' | 'stats' | 'calendar'
type TaskFilter = 'all' | 'today' | 'overdue' | 'completed'
type WorkspaceRuntimeMode = 'workspace' | 'guest' | 'unattached'
type WorkspaceSettingsBusyState = 'loading' | 'updating' | 'leaving' | null

type WorkspaceSyncSnapshot = {
  status: WorkspaceSyncStatus
  pendingOutboxCount: number
  lastError: string | null
}

type AppToast = {
  id: number
  message: string
}

type WorkspacePrimaryNavProps = {
  activeView: WorkspaceView
  setActiveView: (view: WorkspaceView) => void
  activeFilter: TaskFilter
  setActiveFilter: (filter: TaskFilter) => void
  selectedCategoryId: string | null
  setSelectedCategoryId: (id: string | null) => void
  selectedUncategorized: boolean
  setSelectedUncategorized: (value: boolean) => void
  setSelectedTodoId: (value: string | null) => void
  setSelectedEventId: (value: string | null) => void
  sidebarCounts: Record<TaskFilter, number>
  className?: string
  onNavigate?: () => void
}
type BoardStatusColumn = 'not_started' | 'in_progress' | 'blocked'
type StatusBoardColumn = {
  status: BoardStatusColumn
  meta: (typeof todoStatusMeta)[BoardStatusColumn]
  todos: TodoRecord[]
}

type StatsMetricCard = {
  label: string
  value: string
}

type StatsDistributionItem = {
  id: string
  label: string
  value: number
  accent: string
  helper?: string
  tone?: 'primary' | 'danger' | 'category' | 'neutral'
}

type StatsDayLoad = {
  date: string
  label: string
  taskCount: number
  eventCount: number
}

type StatsHistoricalCompletionPoint = {
  date: string
  label: string
  totalCount: number
  completedCount: number
  completionRate: number | null
}

type TodoDraft = {
  title: string
  categoryId: string
  dueDate: string
  myDayDate: string
  status: TodoStatus
  note: string
  recurrenceType: TodoRecurrenceType
}

type EventDraft = {
  title: string
  date: string
  status: EventStatus
  allDay: boolean
  startTime: string
  endTime: string
  note: string
}

type CategoryChipOption = {
  key: string
  categoryId: string
  label: string
  color: string | null
  neutral?: boolean
}

type CalendarCell = {
  date: string
  inCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  entries: CalendarEntry[]
}

type CalendarEntry =
  | {
      id: string
      kind: 'todo'
      date: string
      todo: TodoRecord
    }
  | {
      id: string
      kind: 'event'
      date: string
      event: EventRecord
    }

const categoryPalette = [
  '#2563EB',
  '#16A34A',
  '#F97316',
  '#DC2626',
  '#9333EA',
  '#DB2777',
  '#0891B2',
  '#65A30D',
  '#EA580C',
  '#0F766E',
]
const categorySuggestionLabels = ['工作', '生活', '学习', '书影音', '项目-X']

const filterLabels: Record<TaskFilter, string> = {
  all: '待办箱',
  today: '我的一天',
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

const eventStatusMeta: Record<EventStatus, { label: string; tone: string; accent: string }> = {
  not_completed: {
    label: '未完成',
    tone: '#3457A2',
    accent: '#EDF4FF',
  },
  completed: {
    label: '已完成',
    tone: '#5F6F86',
    accent: '#EEF2F6',
  },
}

const boardStatuses: BoardStatusColumn[] = ['not_started', 'in_progress', 'blocked']
const demoWorkspaceId = 'guest-demo-workspace'
const demoCategories: CategoryRecord[] = [
  {
    id: 'guest-category-work',
    workspaceId: demoWorkspaceId,
    name: '工作',
    color: '#2563EB',
    sortOrder: 0,
    updatedAt: '2026-03-16T08:00:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-category-personal',
    workspaceId: demoWorkspaceId,
    name: '生活',
    color: '#16A34A',
    sortOrder: 1,
    updatedAt: '2026-03-16T08:05:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-category-learning',
    workspaceId: demoWorkspaceId,
    name: '学习',
    color: '#F97316',
    sortOrder: 2,
    updatedAt: '2026-03-16T08:10:00.000Z',
    deleted: false,
  },
]
const demoTodos: TodoRecord[] = [
  {
    id: 'guest-todo-today',
    workspaceId: demoWorkspaceId,
    title: '整理今天的优先事项',
    categoryId: 'guest-category-work',
    dueDate: todayDate(),
    myDayDate: null,
    status: 'not_started',
    completed: false,
    note: '先处理客户反馈，再安排下午的评审。',
    recurrenceType: 'daily',
    updatedAt: '2026-03-16T08:20:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-todo-overdue',
    workspaceId: demoWorkspaceId,
    title: '补完上周遗留的发布检查',
    categoryId: 'guest-category-work',
    dueDate: nextDate(-1),
    myDayDate: null,
    status: 'blocked',
    completed: false,
    note: '卡在设计确认，等最终素材。',
    recurrenceType: 'none',
    updatedAt: '2026-03-15T18:00:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-todo-progress',
    workspaceId: demoWorkspaceId,
    title: '准备周会同步材料',
    categoryId: 'guest-category-learning',
    dueDate: nextDate(1),
    myDayDate: todayDate(),
    status: 'in_progress',
    completed: false,
    note: '',
    recurrenceType: 'weekly',
    updatedAt: '2026-03-16T10:30:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-todo-completed',
    workspaceId: demoWorkspaceId,
    title: '回顾昨天完成的事项',
    categoryId: 'guest-category-personal',
    dueDate: nextDate(-1),
    myDayDate: null,
    status: 'completed',
    completed: true,
    note: '',
    recurrenceType: 'none',
    updatedAt: '2026-03-16T07:40:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-todo-uncategorized',
    workspaceId: demoWorkspaceId,
    title: '把灵感先记进待办箱',
    categoryId: null,
    dueDate: null,
    myDayDate: todayDate(),
    status: 'not_started',
    completed: false,
    note: '未分类任务会先留在 Inbox，之后再分派到列表。',
    recurrenceType: 'monthly',
    updatedAt: '2026-03-16T09:00:00.000Z',
    deleted: false,
  },
]

const demoEvents: EventRecord[] = [
  {
    id: 'guest-event-review',
    workspaceId: demoWorkspaceId,
    title: '产品评审会',
    date: todayDate(),
    status: 'not_completed',
    allDay: false,
    startAt: `${todayDate()}T14:00:00.000Z`,
    endAt: `${todayDate()}T15:00:00.000Z`,
    note: '核对本周需求优先级。',
    updatedAt: '2026-03-16T06:30:00.000Z',
    deleted: false,
  },
  {
    id: 'guest-event-focus',
    workspaceId: demoWorkspaceId,
    title: '深度工作时段',
    date: nextDate(1),
    status: 'not_completed',
    allDay: false,
    startAt: `${nextDate(1)}T01:30:00.000Z`,
    endAt: `${nextDate(1)}T03:00:00.000Z`,
    note: '留给任务推进。',
    updatedAt: '2026-03-16T06:35:00.000Z',
    deleted: false,
  },
]

function createGuestSessionData() {
  return {
    categories: demoCategories.map((category) => ({ ...category })),
    todos: demoTodos.map((todo) => ({ ...todo })),
    events: demoEvents.map((event) => ({ ...event })),
  }
}

function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('create')
  const [activeView, setActiveView] = useState<WorkspaceView>('todos')
  const [passphrase, setPassphrase] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [runtimeMode, setRuntimeMode] = useState<WorkspaceRuntimeMode>('unattached')
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [workspaceSettingsInfo, setWorkspaceSettingsInfo] = useState<WorkspaceSettingsInfo | null>(null)
  const [workspaceSettingsBusyState, setWorkspaceSettingsBusyState] = useState<WorkspaceSettingsBusyState>(null)
  const [workspaceSettingsMessage, setWorkspaceSettingsMessage] = useState('')
  const [workspaceSyncSnapshot, setWorkspaceSyncSnapshot] = useState<WorkspaceSyncSnapshot | null>(null)
  const [toast, setToast] = useState<AppToast | null>(null)
  const [workspacePassphraseDraft, setWorkspacePassphraseDraft] = useState('')
  const [workspacePassphraseConfirm, setWorkspacePassphraseConfirm] = useState('')
  const [confirmLeaveWorkspace, setConfirmLeaveWorkspace] = useState(false)
  const [sessionLabel, setSessionLabel] = useState('尚未建立匿名会话')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [todos, setTodos] = useState<TodoRecord[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])

  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedUncategorized, setSelectedUncategorized] = useState(false)
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonthIso(todayDate()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => todayDate())
  const [quickTodoTitle, setQuickTodoTitle] = useState('')
  const [quickEventTitle, setQuickEventTitle] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState(categoryPalette[0])
  const [categoryEditorName, setCategoryEditorName] = useState('')
  const [categoryEditorColor, setCategoryEditorColor] = useState(categoryPalette[0])
  const [detailDraft, setDetailDraft] = useState<TodoDraft | null>(null)
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null)
  const [confirmDeleteTodo, setConfirmDeleteTodo] = useState(false)
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 980px)').matches : false,
  )
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false)
  const mobileDetailTriggerRef = useRef<HTMLElement | null>(null)
  const mobileSidebarButtonRef = useRef<HTMLButtonElement | null>(null)
  const toastIdRef = useRef(0)
  const lastSavedDraftRef = useRef('')
  const lastSavedEventDraftRef = useRef('')
  const refreshRequestIdRef = useRef(0)
  const workspaceSettingsRequestIdRef = useRef(0)
  const lastSyncErrorToastKeyRef = useRef<string | null>(null)

  const sourceCategories = categories
  const sourceTodos = todos
  const sourceEvents = events
  const isGuestMode = runtimeMode === 'guest'
  const isReadOnly = runtimeMode === 'unattached'
  const showWorkspaceControls = runtimeMode === 'workspace'

  const dismissToast = useEffectEvent(() => {
    setToast(null)
  })

  const showErrorToast = useEffectEvent((nextMessage: string) => {
    toastIdRef.current += 1
    setToast({
      id: toastIdRef.current,
      message: nextMessage,
    })
  })

  const activeCategories = useMemo(
    () =>
      sourceCategories
        .filter((category) => !category.deleted)
        .sort((left, right) => compareCategories(left, right)),
    [sourceCategories],
  )

  const activeTodos = useMemo(
    () =>
      sourceTodos
        .filter((todo) => !todo.deleted)
        .sort((left, right) => compareTodos(left, right)),
    [sourceTodos],
  )
  const activeEvents = useMemo(
    () =>
      sourceEvents
        .filter((event) => !event.deleted)
        .sort((left, right) => left.date.localeCompare(right.date) || left.updatedAt.localeCompare(right.updatedAt)),
    [sourceEvents],
  )

  const selectedCategory =
    activeCategories.find((category) => category.id === selectedCategoryId) ?? null

  const visibleTodos = useMemo(
    () => {
      const filteredTodos = activeTodos.filter((todo) => {
        if (selectedUncategorized) {
          return todo.categoryId === null
        }

        if (selectedCategoryId && todo.categoryId !== selectedCategoryId) {
          return false
        }

        switch (activeFilter) {
          case 'today':
            return isTodoInMyDay(todo)
          case 'overdue':
            return isTodoOverdue(todo)
          case 'completed':
            return todo.status === 'completed'
          default:
            return true
        }
      })

      if (activeFilter !== 'today') {
        return filteredTodos
      }

      return filteredTodos.slice().sort((left, right) => compareMyDayTodos(left, right))
    },
    [activeFilter, activeTodos, selectedCategoryId, selectedUncategorized],
  )

  const selectedTodo = activeTodos.find((todo) => todo.id === selectedTodoId) ?? null
  const selectedEvent = activeEvents.find((event) => event.id === selectedEventId) ?? null
  const boardColumns = useMemo(
    () =>
      boardStatuses.map((status) => ({
        status,
        meta: todoStatusMeta[status],
        todos: activeTodos.filter((todo) => todo.status === status),
      })),
    [activeTodos],
  )
  const calendarEntriesByDate = useMemo(() => groupCalendarEntriesByDate(activeTodos, activeEvents), [activeEvents, activeTodos])
  const shouldShowTodoCategoryMeta =
    (activeFilter === 'all' || activeFilter === 'today') && !selectedCategoryId && !selectedUncategorized
  const sidebarCounts = useMemo(
    () => ({
      all: activeTodos.length,
      today: activeTodos.filter((todo) => isIncompleteTodoInMyDay(todo)).length,
      overdue: activeTodos.filter((todo) => isTodoOverdue(todo)).length,
      completed: activeTodos.filter((todo) => todo.status === 'completed').length,
    }),
    [activeTodos],
  )
  const statsSummary = useMemo(() => buildStatsSummary(activeTodos, activeEvents), [activeTodos, activeEvents])
  const statsMetricCards = useMemo<StatsMetricCard[]>(
    () => [
      {
        label: '完成任务',
        value: String(statsSummary.completedTodos),
      },
      {
        label: '完成率',
        value: formatPercentage(statsSummary.completionRate),
      },
      {
        label: '今日聚焦',
        value: String(statsSummary.todayFocusTodos),
      },
      {
        label: '未来 7 天安排',
        value: String(statsSummary.upcomingScheduledItems),
      },
    ],
    [statsSummary],
  )
  const statusDistribution = useMemo<StatsDistributionItem[]>(
    () => [
      { id: 'not_started', label: '未开始', value: statsSummary.statusCounts.not_started, accent: '#1f6e66', tone: 'primary' },
      { id: 'in_progress', label: '进行中', value: statsSummary.statusCounts.in_progress, accent: '#1f6e66', tone: 'primary' },
      { id: 'completed', label: '已完成', value: statsSummary.statusCounts.completed, accent: '#1f6e66', tone: 'primary' },
      { id: 'blocked', label: '阻塞', value: statsSummary.statusCounts.blocked, accent: '#1f6e66', tone: 'primary' },
      { id: 'canceled', label: '取消', value: statsSummary.statusCounts.canceled, accent: '#1f6e66', tone: 'primary' },
    ],
    [statsSummary],
  )
  const dueDistribution = useMemo<StatsDistributionItem[]>(
    () => [
      { id: 'overdue', label: '已逾期', value: statsSummary.dueBuckets.overdue, accent: '#1f6e66', tone: 'primary' },
      { id: 'today', label: '今天', value: statsSummary.dueBuckets.today, accent: '#1f6e66', tone: 'primary' },
      { id: 'next-seven', label: '7 天内', value: statsSummary.dueBuckets.nextSevenDays, accent: '#1f6e66', tone: 'primary' },
      { id: 'later', label: '更晚', value: statsSummary.dueBuckets.later, accent: '#1f6e66', tone: 'primary' },
      { id: 'none', label: '无日期', value: statsSummary.dueBuckets.noDate, accent: '#1f6e66', tone: 'primary' },
    ],
    [statsSummary],
  )
  const categoryDistribution = useMemo<StatsDistributionItem[]>(
    () => buildCategoryDistribution(activeTodos, activeCategories),
    [activeCategories, activeTodos],
  )
  const nextSevenDayLoad = useMemo<StatsDayLoad[]>(() => buildUpcomingDayLoad(activeTodos, activeEvents), [activeEvents, activeTodos])
  const historicalCompletionSeries = useMemo<StatsHistoricalCompletionPoint[]>(() => buildHistoricalCompletionSeries(activeTodos), [activeTodos])
  const hasWorkspaceSettingsSyncRisk =
    (workspaceSettingsInfo?.syncStatus.pendingOutboxCount ?? 0) > 0 ||
    workspaceSettingsInfo?.syncStatus.status === 'error'
  const isWorkspaceSyncing =
    workspaceSyncSnapshot?.status === 'pushing' || workspaceSyncSnapshot?.status === 'pulling'

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current))
    }, 10_000)

    return () => window.clearTimeout(timer)
  }, [toast])

  function applyWorkspaceSyncSnapshot(
    snapshot: WorkspaceSyncSnapshot | null,
    targetWorkspaceId = workspaceId,
  ) {
    if (snapshot?.status === 'error') {
      const normalizedMessage = snapshot.lastError
        ? normalizeSyncErrorMessage(snapshot.lastError)
        : '同步失败，请稍后重试。'
      const nextKey = `${targetWorkspaceId}:${normalizedMessage}`

      if (lastSyncErrorToastKeyRef.current !== nextKey) {
        lastSyncErrorToastKeyRef.current = nextKey
        showErrorToast(normalizedMessage)
      }
    } else {
      lastSyncErrorToastKeyRef.current = null
    }

    setWorkspaceSyncSnapshot(snapshot)
    setWorkspaceSettingsInfo((current) =>
      current && current.workspaceId === targetWorkspaceId && snapshot
        ? {
            ...current,
            syncStatus: snapshot,
          }
        : current,
    )
  }

  async function readWorkspaceSyncSnapshot(targetWorkspaceId = workspaceId) {
    if (!targetWorkspaceId) {
      applyWorkspaceSyncSnapshot(null, targetWorkspaceId)
      return null
    }

    const [syncMeta, pendingOutbox] = await Promise.all([
      readSyncMeta(targetWorkspaceId),
      listPendingOutbox(targetWorkspaceId),
    ])

    const snapshot: WorkspaceSyncSnapshot = {
      status: syncMeta?.status ?? 'idle',
      pendingOutboxCount: pendingOutbox.length,
      lastError: syncMeta?.lastError ?? null,
    }

    applyWorkspaceSyncSnapshot(snapshot, targetWorkspaceId)
    return snapshot
  }

  function setOptimisticWorkspaceSyncStatus(
    status: Extract<WorkspaceSyncStatus, 'pushing' | 'pulling'>,
    targetWorkspaceId = workspaceId,
  ) {
    const fallback: WorkspaceSyncSnapshot = {
      status,
      pendingOutboxCount: 0,
      lastError: null,
    }

    applyWorkspaceSyncSnapshot(
      {
        ...(workspaceSyncSnapshot ?? fallback),
        status,
        lastError: null,
      },
      targetWorkspaceId,
    )
  }

  async function loadWorkspaceSettingsInfo(targetWorkspaceId = workspaceId) {
    if (!targetWorkspaceId) {
      setWorkspaceSettingsInfo(null)
      setWorkspaceSettingsMessage('当前没有可管理的工作区。')
      return
    }

    const requestId = workspaceSettingsRequestIdRef.current + 1
    workspaceSettingsRequestIdRef.current = requestId
    setWorkspaceSettingsBusyState('loading')
    setWorkspaceSettingsMessage('')

    try {
      const [workspaceMeta, syncSnapshot] = await Promise.all([
        getCurrentWorkspaceMeta(),
        readWorkspaceSyncSnapshot(targetWorkspaceId),
      ])

      if (workspaceSettingsRequestIdRef.current !== requestId) {
        return
      }

      if (!workspaceMeta || workspaceMeta.workspaceId !== targetWorkspaceId) {
        throw new Error('缺少当前工作区上下文。')
      }

      setWorkspaceSettingsInfo({
        workspaceId: targetWorkspaceId,
        syncStatus: {
          status: syncSnapshot?.status ?? 'idle',
          pendingOutboxCount: syncSnapshot?.pendingOutboxCount ?? 0,
        },
      })
    } catch (error) {
      if (workspaceSettingsRequestIdRef.current !== requestId) {
        return
      }

      setWorkspaceSettingsInfo(null)
      setWorkspaceSettingsMessage('')
      showErrorToast(error instanceof Error ? error.message : '读取工作区设置失败。')
    } finally {
      if (workspaceSettingsRequestIdRef.current === requestId) {
        setWorkspaceSettingsBusyState(null)
      }
    }
  }

  function openWorkspaceSettings() {
    if (runtimeMode !== 'workspace' || !workspaceId) {
      return
    }

    setWorkspaceSettingsOpen(true)
    setConfirmLeaveWorkspace(false)
    setWorkspacePassphraseDraft('')
    setWorkspacePassphraseConfirm('')
    setWorkspaceSettingsMessage('')
    void loadWorkspaceSettingsInfo(workspaceId)
  }

  function closeWorkspaceSettings() {
    workspaceSettingsRequestIdRef.current += 1
    setWorkspaceSettingsOpen(false)
    setConfirmLeaveWorkspace(false)
    setWorkspacePassphraseDraft('')
    setWorkspacePassphraseConfirm('')
    setWorkspaceSettingsBusyState(null)
    setWorkspaceSettingsMessage('')
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 980px)')
    const updateViewportState = () => {
      setIsMobileViewport(mediaQuery.matches)
    }

    updateViewportState()
    mediaQuery.addEventListener('change', updateViewportState)

    return () => {
      mediaQuery.removeEventListener('change', updateViewportState)
    }
  }, [])

  useEffect(() => {
    void runIndexedDbProbe().catch(() => undefined)

    const restore = async () => {
      const restoredWorkspaceId = await loadWorkspaceId()
      if (!restoredWorkspaceId) {
        setRuntimeMode('unattached')
        setWorkspaceDialogOpen(true)
        setMessage('')
        return
      }

      await refreshWorkspaceData(restoredWorkspaceId)
      setMessage(`已恢复最近工作区：${restoredWorkspaceId}`)
    }

    void restore()
    // `refreshWorkspaceData` is intentionally invoked only during initial restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (runtimeMode === 'workspace') {
      return
    }

    setWorkspaceSettingsOpen(false)
  }, [runtimeMode])

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

    const nextDraft = toTodoDraft(selectedTodo)

    setDetailDraft(nextDraft)
    setConfirmDeleteTodo(false)
    lastSavedDraftRef.current = serializeTodoDraft(nextDraft)
  }, [selectedTodo])

  useEffect(() => {
    if (!selectedEvent) {
      setEventDraft(null)
      lastSavedEventDraftRef.current = ''
      setConfirmDeleteEvent(false)
      return
    }

    const nextDraft = {
      title: selectedEvent.title,
      date: selectedEvent.date,
      status: selectedEvent.status,
      allDay: selectedEvent.allDay,
      startTime: toTimeInputValue(selectedEvent.startAt),
      endTime: toTimeInputValue(selectedEvent.endAt),
      note: selectedEvent.note,
    }

    setEventDraft(nextDraft)
    setConfirmDeleteEvent(false)
    lastSavedEventDraftRef.current = serializeEventDraft(nextDraft)
  }, [selectedEvent])

  useEffect(() => {
    if (activeView !== 'calendar') {
      return
    }

    const targetDate = selectedTodo?.dueDate ?? selectedEvent?.date
    if (!targetDate) {
      return
    }

    setSelectedCalendarDate(targetDate)
    setCalendarMonth((current) => {
      const nextMonth = startOfMonthIso(targetDate)
      return current === nextMonth ? current : nextMonth
    })
  }, [activeView, selectedEvent?.date, selectedTodo?.dueDate])

  const persistTodoDraft = useEffectEvent(async (draft: TodoDraft, baseTodo: TodoRecord) => {
    if (!workspaceId || !draft.title.trim()) {
      return
    }

    const updated: TodoRecord = {
      ...baseTodo,
      title: draft.title.trim(),
      categoryId: draft.categoryId || null,
      dueDate: draft.dueDate || null,
      myDayDate: draft.myDayDate || null,
      status: draft.status,
      note: draft.note,
      recurrenceType: draft.recurrenceType,
      completed: draft.status === 'completed',
      updatedAt: new Date().toISOString(),
    }

    if (isGuestMode) {
      lastSavedDraftRef.current = serializeTodoDraft({
        title: updated.title,
        categoryId: updated.categoryId ?? '',
        dueDate: updated.dueDate ?? '',
        myDayDate: updated.myDayDate ?? '',
        status: updated.status,
        note: updated.note,
        recurrenceType: updated.recurrenceType,
      })
      setTodos((current) => current.map((todo) => (todo.id === updated.id ? updated : todo)))
      return
    }

    await upsertTodo(updated)
    await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
    lastSavedDraftRef.current = serializeTodoDraft({
      title: updated.title,
      categoryId: updated.categoryId ?? '',
      dueDate: updated.dueDate ?? '',
      myDayDate: updated.myDayDate ?? '',
      status: updated.status,
      note: updated.note,
      recurrenceType: updated.recurrenceType,
    })
    setTodos((current) => current.map((todo) => (todo.id === updated.id ? updated : todo)))
    triggerBackgroundPush('推送任务详情自动保存失败')
  })

  const persistEventDraft = useEffectEvent(async (draft: EventDraft, baseEvent: EventRecord) => {
    if (!workspaceId || !draft.title.trim()) {
      return
    }

    const normalized = normalizeEventDraft(draft)
    const updated: EventRecord = {
      ...baseEvent,
      title: normalized.title.trim(),
      date: normalized.date,
      status: normalized.status,
      allDay: normalized.allDay,
      startAt: normalized.allDay ? null : buildEventTimestamp(normalized.date, normalized.startTime),
      endAt: normalized.allDay ? null : buildEventTimestamp(normalized.date, normalized.endTime),
      note: normalized.note,
      updatedAt: new Date().toISOString(),
    }

    if (isGuestMode) {
      lastSavedEventDraftRef.current = serializeEventDraft({
        title: updated.title,
        date: updated.date,
        status: updated.status,
        allDay: updated.allDay,
        startTime: toTimeInputValue(updated.startAt),
        endTime: toTimeInputValue(updated.endAt),
        note: updated.note,
      })
      setEvents((current) => current.map((event) => (event.id === updated.id ? updated : event)))
      return
    }

    await upsertEvent(updated)
    await enqueueRecordMutation('events', 'upsert', toSyncEvent(updated))
    lastSavedEventDraftRef.current = serializeEventDraft({
      title: updated.title,
      date: updated.date,
      status: updated.status,
      allDay: updated.allDay,
      startTime: toTimeInputValue(updated.startAt),
      endTime: toTimeInputValue(updated.endAt),
      note: updated.note,
    })
    setEvents((current) => current.map((event) => (event.id === updated.id ? updated : event)))
    triggerBackgroundPush('推送事件详情自动保存失败')
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

  useEffect(() => {
    if (!selectedEvent || !eventDraft) {
      return
    }

    const nextSignature = serializeEventDraft(eventDraft)
    if (nextSignature === lastSavedEventDraftRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistEventDraft(eventDraft, selectedEvent)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [eventDraft, selectedEvent])

  async function hydrateWorkspaceData(resolvedWorkspaceId: string, requestId = refreshRequestIdRef.current) {
    const [workspaceMeta, nextCategories, nextTodos, nextEvents] = await Promise.all([
      getCurrentWorkspaceMeta(),
      listCategories(resolvedWorkspaceId),
      listTodos(resolvedWorkspaceId),
      listEvents(resolvedWorkspaceId),
    ])

    if (requestId !== refreshRequestIdRef.current) {
      return
    }

    setWorkspaceId(resolvedWorkspaceId)
    setRuntimeMode('workspace')
    setWorkspaceDialogOpen(false)
    setCategories(nextCategories)
    setTodos(nextTodos)
    setEvents(nextEvents)
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
    setSelectedEventId((current) =>
      current && nextEvents.some((event) => event.id === current && !event.deleted) ? current : null,
    )

    await readWorkspaceSyncSnapshot(resolvedWorkspaceId)
  }

  async function refreshWorkspaceData(nextWorkspaceId?: string) {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId
    const resolvedWorkspaceId = nextWorkspaceId ?? (await loadWorkspaceId())
    if (!resolvedWorkspaceId) {
      if (requestId !== refreshRequestIdRef.current) {
        return
      }

      setWorkspaceId('')
      setRuntimeMode('unattached')
      setCategories([])
      setTodos([])
      setEvents([])
      setSelectedCategoryId(null)
      setSelectedUncategorized(false)
      setActiveFilter('all')
      setSelectedTodoId(null)
      setSelectedEventId(null)
      applyWorkspaceSyncSnapshot(null)
      setActiveView('todos')
      setSessionLabel('尚未建立匿名会话')
      return
    }

    try {
      setOptimisticWorkspaceSyncStatus('pushing', resolvedWorkspaceId)
      await pushPendingOperations()
    } catch (error) {
      console.warn('刷新工作区时推送本地变更失败', error)
    }

    try {
      setOptimisticWorkspaceSyncStatus('pulling', resolvedWorkspaceId)
      const pullResult = await pullRemoteChanges()
      await reconcileRemoteChanges(resolvedWorkspaceId, pullResult)
    } catch (error) {
      console.warn('刷新工作区时拉取远端数据失败', error)
    }

    await hydrateWorkspaceData(resolvedWorkspaceId, requestId)
  }

  async function handleWorkspaceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isSupabaseConfigured) {
      showErrorToast('缺少 Supabase 环境变量，当前无法创建或加入工作区。')
      return
    }

    if (passphrase.trim().length < 6) {
      showErrorToast('工作区口令至少需要 6 个字符。')
      return
    }

    setBusy(true)
    try {
      const session = await ensureAnonymousSession()
      const response = await invokeWorkspaceFunction(workspaceMode, passphrase.trim())

      await saveWorkspaceId(response.workspaceId)
      await saveCurrentWorkspaceMeta(response.workspaceId, session.user.id)
      await refreshWorkspaceData(response.workspaceId)

      setRuntimeMode('workspace')
      setWorkspaceDialogOpen(false)
      setMessage(
        `${workspaceMode === 'create' ? '创建' : '加入'}工作区成功，已进入任务工作台。`,
      )
      setPassphrase('')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : '工作区操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleManualSync() {
    if (runtimeMode !== 'workspace' || !workspaceId || isWorkspaceSyncing) {
      return
    }

    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId

    try {
      setOptimisticWorkspaceSyncStatus('pushing', workspaceId)
      await pushPendingOperations()

      setOptimisticWorkspaceSyncStatus('pulling', workspaceId)
      const pullResult = await pullRemoteChanges()
      await reconcileRemoteChanges(workspaceId, pullResult)
      await hydrateWorkspaceData(workspaceId, requestId)
    } catch (error) {
      await readWorkspaceSyncSnapshot(workspaceId)
      if (!(error instanceof Error)) {
        showErrorToast('同步失败，请稍后重试。')
      }
    }
  }

  function triggerBackgroundPush(logMessage: string, targetWorkspaceId = workspaceId) {
    if (runtimeMode !== 'workspace' || !targetWorkspaceId || isWorkspaceSyncing) {
      return
    }

    setOptimisticWorkspaceSyncStatus('pushing', targetWorkspaceId)
    void pushPendingOperations()
      .catch((error) => {
        console.warn(logMessage, error)
      })
      .finally(() => {
        void readWorkspaceSyncSnapshot(targetWorkspaceId)
      })
  }

  async function handleUpdateWorkspacePassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!workspaceId) {
      showErrorToast('当前没有可更新口令的工作区。')
      return
    }

    if (!isSupabaseConfigured) {
      showErrorToast('缺少 Supabase 环境变量，当前无法更新工作区口令。')
      return
    }

    const nextPassphrase = workspacePassphraseDraft.trim()
    const confirmPassphrase = workspacePassphraseConfirm.trim()

    if (nextPassphrase.length < 6) {
      showErrorToast('新口令至少需要 6 个字符。')
      return
    }

    if (nextPassphrase !== confirmPassphrase) {
      showErrorToast('两次输入的新口令不一致。')
      return
    }

    setWorkspaceSettingsBusyState('updating')
    try {
      const workspaceMeta = await getCurrentWorkspaceMeta()
      await updateWorkspacePassphrase(workspaceId, nextPassphrase, workspaceMeta?.anonymousUserId ?? null)
      setWorkspacePassphraseDraft('')
      setWorkspacePassphraseConfirm('')
      setConfirmLeaveWorkspace(false)
      setWorkspaceSettingsMessage('工作区口令已更新。')
      setMessage('工作区口令已更新。')
    } catch (error) {
      showErrorToast(
        error instanceof Error ? normalizeWorkspacePassphraseUpdateError(error.message) : '工作区口令更新失败。',
      )
    } finally {
      setWorkspaceSettingsBusyState(null)
    }
  }

  async function handleLeaveWorkspace() {
    if (!workspaceId) {
      showErrorToast('当前没有可退出的工作区。')
      return
    }

    setWorkspaceSettingsBusyState('leaving')
    try {
      await clearCurrentWorkspaceMeta()
      closeWorkspaceSettings()
      await refreshWorkspaceData('')
      openWorkspaceDialog('join')
      setIsMobileSidebarOpen(false)
      setMessage('已退出当前工作区。')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : '退出工作区失败。')
    } finally {
      setWorkspaceSettingsBusyState(null)
    }
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
      sortOrder: getNextCategorySortOrder(activeCategories),
      updatedAt: new Date().toISOString(),
      deleted: false,
    }

    setBusy(true)
    try {
      if (isGuestMode) {
        setCategories((current) => [...current, record])
        setSelectedCategoryId(record.id)
        setActiveFilter('all')
        setNewCategoryName('')
        setNewCategoryColor(categoryPalette[(activeCategories.length + 1) % categoryPalette.length])
        setMessage(`分类「${record.name}」已创建。`)
        return
      }

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
      if (isGuestMode) {
        setCategories((current) => current.map((category) => (category.id === updated.id ? updated : category)))
        setMessage(`分类「${updated.name}」已更新。`)
        return
      }

      await upsertCategory(updated)
      await enqueueRecordMutation('categories', 'upsert', toSyncCategory(updated))
      await refreshWorkspaceData(workspaceId)
      setMessage(`分类「${updated.name}」已更新。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleReorderCategories(orderedIds: string[]) {
    if (!orderedIds.length || areCategoryOrdersEqual(orderedIds, activeCategories.map((category) => category.id))) {
      return
    }

    const timestamp = new Date().toISOString()
    const currentCategoryMap = new Map(activeCategories.map((category) => [category.id, category]))
    const reorderedCategories = buildReorderedCategories(activeCategories, orderedIds).map((category) => {
      const previousCategory = currentCategoryMap.get(category.id)
      return {
        ...category,
        updatedAt: previousCategory?.sortOrder === category.sortOrder ? category.updatedAt : timestamp,
      }
    })
    const changedCategories = reorderedCategories.filter(
      (category) => currentCategoryMap.get(category.id)?.sortOrder !== category.sortOrder,
    )

    if (!changedCategories.length) {
      return
    }

    const nextCategoryMap = new Map(reorderedCategories.map((category) => [category.id, category]))
    setCategories((current) => current.map((category) => nextCategoryMap.get(category.id) ?? category))

    if (isGuestMode) {
      setMessage('分类顺序已更新。')
      return
    }

    setBusy(true)
    try {
      await Promise.all(changedCategories.map((category) => upsertCategory(category)))
      await Promise.all(
        changedCategories.map((category) => enqueueRecordMutation('categories', 'upsert', toSyncCategory(category))),
      )
      await refreshWorkspaceData(workspaceId)
      setMessage('分类顺序已更新。')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : '更新分类顺序失败。')
      await refreshWorkspaceData(workspaceId)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteCategory(categoryOverride?: CategoryRecord) {
    const targetCategory = categoryOverride ?? selectedCategory

    if (!workspaceId || !targetCategory) {
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
      if (isGuestMode) {
        setTodos((current) =>
          current.map((todo) =>
            todo.categoryId === targetCategory.id
              ? {
                  ...todo,
                  categoryId: null,
                  updatedAt: timestamp,
                }
              : todo,
          ),
        )
        setCategories((current) =>
          current.map((category) => (category.id === deletedCategory.id ? deletedCategory : category)),
        )
        setSelectedCategoryId(null)
        setMessage(`分类「${targetCategory.name}」已删除，关联任务已回到未分类。`)
        return
      }

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
      null,
    )

    setBusy(true)
    try {
      if (isGuestMode) {
        setTodos((current) => [record, ...current])
        setQuickTodoTitle('')
        setSelectedTodoId(record.id)
        setSelectedEventId(null)
        setMessage(`任务「${record.title}」已创建。`)
        return
      }

      await upsertTodo(record)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(record))
      setTodos((current) => [record, ...current])
      setQuickTodoTitle('')
      setSelectedTodoId(record.id)
      setSelectedEventId(null)
      setMessage(`任务「${record.title}」已创建。`)
      triggerBackgroundPush('推送新建任务失败')
    } finally {
      setBusy(false)
    }
  }

  function getMutableTodoBase(todo: TodoRecord) {
    const hasUnsavedSelectedDraft =
      selectedTodoId === todo.id &&
      detailDraft &&
      serializeTodoDraft(detailDraft) !== lastSavedDraftRef.current

    if (!hasUnsavedSelectedDraft || !detailDraft) {
      return todo
    }

    return {
      ...todo,
      title: detailDraft.title.trim() || todo.title,
      categoryId: detailDraft.categoryId || null,
      dueDate: detailDraft.dueDate || null,
      myDayDate: detailDraft.myDayDate || null,
      note: detailDraft.note,
      recurrenceType: detailDraft.recurrenceType,
    }
  }

  async function handleSetTodoStatus(todo: TodoRecord, nextStatus: TodoStatus, baseTodo = getMutableTodoBase(todo)) {
    if (!workspaceId || baseTodo.status === nextStatus) {
      return
    }

    const updatedAt = new Date().toISOString()
    const updated: TodoRecord = {
      ...baseTodo,
      status: nextStatus,
      completed: nextStatus === 'completed',
      updatedAt,
    }
    const shouldCreateRecurringTodo =
      nextStatus === 'completed' &&
      baseTodo.recurrenceType !== 'none' &&
      Boolean(baseTodo.dueDate)
    const recurringTodo =
      shouldCreateRecurringTodo && baseTodo.dueDate
        ? createNextRecurringTodo(baseTodo, updatedAt)
        : null

    setBusy(true)
    try {
      if (isGuestMode) {
        const nextDraft = toTodoDraft(updated)
        lastSavedDraftRef.current = serializeTodoDraft(nextDraft)
        if (selectedTodoId === todo.id) {
          setDetailDraft(nextDraft)
        }
        setTodos((current) => {
          const nextTodos = current.map((item) => (item.id === updated.id ? updated : item))
          return recurringTodo ? [recurringTodo, ...nextTodos] : nextTodos
        })
        setMessage(
          recurringTodo
            ? `任务「${todo.title}」已完成，并已生成下一次：${formatMonthDay(recurringTodo.dueDate!)}。`
            : `任务「${todo.title}」状态已切换为 ${todoStatusMeta[updated.status].label}。`,
        )
        return
      }

      await upsertTodo(updated)
      await enqueueRecordMutation('todos', 'upsert', toSyncTodo(updated))
      if (recurringTodo) {
        await upsertTodo(recurringTodo)
        await enqueueRecordMutation('todos', 'upsert', toSyncTodo(recurringTodo))
      }
      const nextDraft = toTodoDraft(updated)
      lastSavedDraftRef.current = serializeTodoDraft(nextDraft)
      if (selectedTodoId === todo.id) {
        setDetailDraft(nextDraft)
      }
      setTodos((current) => {
        const nextTodos = current.map((item) => (item.id === updated.id ? updated : item))
        return recurringTodo ? [recurringTodo, ...nextTodos] : nextTodos
      })
      setMessage(
        recurringTodo
          ? `任务「${todo.title}」已完成，并已生成下一次：${formatMonthDay(recurringTodo.dueDate!)}。`
          : `任务「${todo.title}」状态已切换为 ${todoStatusMeta[updated.status].label}。`,
      )
      triggerBackgroundPush('推送任务状态变更失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleTodo(todo: TodoRecord) {
    const baseTodo = getMutableTodoBase(todo)
    await handleSetTodoStatus(todo, toggleTodoStatus(baseTodo.status), baseTodo)
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
      if (isGuestMode) {
        setTodos((current) =>
          current.map((todo) => (todo.id === deletedTodo.id ? deletedTodo : todo)),
        )
        setSelectedTodoId(null)
        setMessage(`任务「${selectedTodo.title}」已删除。`)
        return
      }

      await upsertTodo(deletedTodo)
      await enqueueRecordMutation('todos', 'soft-delete', toSyncTodo(deletedTodo))
      await refreshWorkspaceData(workspaceId)
      setSelectedTodoId(null)
      setMessage(`任务「${selectedTodo.title}」已删除。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleQuickCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId || !quickEventTitle.trim()) {
      return
    }

    const record = createEventRecord(workspaceId, quickEventTitle.trim(), selectedCalendarDate)

    setBusy(true)
    try {
      if (isGuestMode) {
        setEvents((current) => [record, ...current])
        setQuickEventTitle('')
        setSelectedTodoId(null)
        setSelectedEventId(record.id)
        setMessage(`事件「${record.title}」已添加到 ${formatCalendarFullDate(record.date)}。`)
        return
      }

      await upsertEvent(record)
      await enqueueRecordMutation('events', 'upsert', toSyncEvent(record))
      await refreshWorkspaceData(workspaceId)
      setQuickEventTitle('')
      setSelectedTodoId(null)
      setSelectedEventId(record.id)
      setMessage(`事件「${record.title}」已添加到 ${formatCalendarFullDate(record.date)}。`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteEvent() {
    if (!workspaceId || !selectedEvent) {
      return
    }

    const deletedEvent: EventRecord = {
      ...selectedEvent,
      deleted: true,
      updatedAt: new Date().toISOString(),
    }

    setBusy(true)
    try {
      if (isGuestMode) {
        setEvents((current) =>
          current.map((event) => (event.id === deletedEvent.id ? deletedEvent : event)),
        )
        setSelectedEventId(null)
        setMessage(`事件「${selectedEvent.title}」已删除。`)
        return
      }

      await upsertEvent(deletedEvent)
      await enqueueRecordMutation('events', 'soft-delete', toSyncEvent(deletedEvent))
      await refreshWorkspaceData(workspaceId)
      setSelectedEventId(null)
      setMessage(`事件「${selectedEvent.title}」已删除。`)
    } finally {
      setBusy(false)
    }
  }

  const restoreMobileDetailFocus = () => {
    window.setTimeout(() => {
      mobileDetailTriggerRef.current?.focus()
    }, 0)
  }

  const closeMobileSidebar = (restoreFocus = false) => {
    setIsMobileSidebarOpen(false)
    if (restoreFocus) {
      window.setTimeout(() => {
        mobileSidebarButtonRef.current?.focus()
      }, 0)
    }
  }

  const closeDetail = (restoreFocus = isMobileViewport) => {
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setIsMobileDetailOpen(false)
    if (restoreFocus && isMobileViewport) {
      restoreMobileDetailFocus()
    }
  }

  const handleSelectTodo = (todoId: string, trigger?: HTMLElement | null) => {
    if (trigger) {
      mobileDetailTriggerRef.current = trigger
    }
    setSelectedTodoId(todoId)
    setSelectedEventId(null)
    if (isMobileViewport && activeView !== 'board' && activeView !== 'stats') {
      setIsMobileDetailOpen(true)
    }
  }

  const handleSelectEvent = (eventId: string, trigger?: HTMLElement | null) => {
    if (trigger) {
      mobileDetailTriggerRef.current = trigger
    }
    setSelectedEventId(eventId)
    setSelectedTodoId(null)
    if (isMobileViewport && activeView !== 'board' && activeView !== 'stats') {
      setIsMobileDetailOpen(true)
    }
  }

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false)
      setIsMobileDetailOpen(false)
      return
    }

    if (activeView === 'board' || activeView === 'stats') {
      setIsMobileDetailOpen(false)
      return
    }

    setIsMobileDetailOpen(Boolean(selectedTodoId || selectedEventId))
  }, [activeView, isMobileViewport, selectedEventId, selectedTodoId])

  useEffect(() => {
    if (!isMobileViewport || (!isMobileSidebarOpen && !isMobileDetailOpen)) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (isMobileSidebarOpen) {
        closeMobileSidebar(true)
        return
      }

      if (isMobileDetailOpen) {
        setSelectedTodoId(null)
        setSelectedEventId(null)
        setIsMobileDetailOpen(false)
        restoreMobileDetailFocus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMobileDetailOpen, isMobileSidebarOpen, isMobileViewport])

  useEffect(() => {
    if (!isMobileViewport || (!isMobileSidebarOpen && !isMobileDetailOpen)) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isMobileDetailOpen, isMobileSidebarOpen, isMobileViewport])

  function openWorkspaceDialog(mode: WorkspaceMode = workspaceMode) {
    setWorkspaceMode(mode)
    setPassphrase('')
    setMessage('')
    setWorkspaceDialogOpen(true)
  }

  function closeWorkspaceDialog() {
    setWorkspaceDialogOpen(false)
  }

  function enterGuestMode() {
    const guestSession = createGuestSessionData()

    setRuntimeMode('guest')
    setWorkspaceId(demoWorkspaceId)
    setWorkspaceDialogOpen(false)
    setWorkspaceSettingsOpen(false)
    setWorkspaceSettingsInfo(null)
    setWorkspaceSettingsMessage('')
    applyWorkspaceSyncSnapshot(null)
    setCategories(guestSession.categories)
    setTodos(guestSession.todos)
    setEvents(guestSession.events)
    setSelectedCategoryId(null)
    setSelectedUncategorized(false)
    setActiveFilter('all')
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setActiveView('todos')
    setCalendarMonth(startOfMonthIso(todayDate()))
    setSelectedCalendarDate(todayDate())
    setQuickTodoTitle('')
    setQuickEventTitle('')
    setSessionLabel('游客模式（本次会话）')
    setMessage('当前改动仅保留在本次会话。')
  }

  const shouldShowDesktopCalendarDetail = !isMobileViewport && activeView === 'calendar' && Boolean(selectedTodoId || selectedEventId)
  const shouldShowDesktopTodoDetail =
    !isMobileViewport && activeView !== 'board' && activeView !== 'stats' && activeView !== 'calendar' && Boolean(selectedTodoId)

  const shellClassName = [
    'workspace-shell',
    activeView === 'calendar' ? 'calendar-layout' : '',
    shouldShowDesktopCalendarDetail || shouldShowDesktopTodoDetail ? 'has-detail' : '',
    isMobileViewport ? 'mobile-workspace-shell' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const boardTitle =
    activeView === 'calendar'
      ? '日程概览'
      : activeView === 'board'
        ? '看板'
        : activeView === 'stats'
          ? '数据统计'
          : selectedUncategorized
            ? '未分类'
            : selectedCategory
              ? selectedCategory.name
              : filterLabels[activeFilter]

  const sidebarProps = {
    workspaceId,
    sessionLabel,
    workspaceLabel: 'PlanTick',
    activeView,
    setActiveView,
    activeFilter,
    setActiveFilter,
    selectedCategoryId,
    setSelectedCategoryId,
    selectedUncategorized,
    setSelectedUncategorized,
    setSelectedTodoId,
    setSelectedEventId,
    sidebarCounts,
    categories: activeCategories,
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
    handleReorderCategories,
    handleDeleteCategory,
    openWorkspaceSettings,
    workspaceSyncSnapshot,
    handleManualSync,
    showWorkspaceControls,
    isGuestMode,
    openWorkspaceDialog,
    busy,
  }

  return (
    <>
      <main className={shellClassName}>
        {isMobileViewport ? null : (
          <Sidebar
            {...sidebarProps}
            readOnly={isReadOnly}
          />
        )}

        {isMobileViewport && isMobileSidebarOpen ? (
          <div className="mobile-sidebar-layer">
            <button
              type="button"
              className="mobile-sidebar-backdrop"
              aria-label="关闭侧边抽屉"
              onClick={() => closeMobileSidebar(true)}
            />
            <div className="mobile-sidebar-shell" role="dialog" aria-modal="true" aria-label="侧边导航">
              <Sidebar
                {...sidebarProps}
                id="mobile-sidebar-drawer"
                className="sidebar-pane sidebar-pane-drawer"
                onNavigate={() => closeMobileSidebar()}
                readOnly={isReadOnly}
              />
            </div>
          </div>
        ) : null}

        <section className="board-pane">
          {isMobileViewport ? (
            <header className="mobile-board-toolbar">
              <button
                ref={mobileSidebarButtonRef}
                type="button"
                className="mobile-toolbar-button"
                aria-label={isMobileSidebarOpen ? '关闭侧边抽屉' : '打开侧边抽屉'}
                aria-expanded={isMobileSidebarOpen}
                aria-controls="mobile-sidebar-drawer"
                onClick={() => setIsMobileSidebarOpen((current) => !current)}
              >
                <Menu size={20} strokeWidth={2.2} />
              </button>
              <div className="mobile-board-toolbar-copy">
                <h1>{boardTitle}</h1>
              </div>
            </header>
          ) : null}

          <WorkspacePrimaryNav
            className="board-primary-nav"
            activeView={activeView}
            setActiveView={setActiveView}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            selectedCategoryId={selectedCategoryId}
            setSelectedCategoryId={setSelectedCategoryId}
            selectedUncategorized={selectedUncategorized}
            setSelectedUncategorized={setSelectedUncategorized}
            setSelectedTodoId={setSelectedTodoId}
            setSelectedEventId={setSelectedEventId}
            sidebarCounts={sidebarCounts}
          />

          {isMobileViewport || activeView === 'calendar' ? null : (
            <header className="board-header">
              <div className="board-heading">
                <h1>{boardTitle}</h1>
              </div>
            </header>
          )}

          {activeView === 'calendar' ? (
            <CalendarBoard
              entriesByDate={calendarEntriesByDate}
              selectedDate={selectedCalendarDate}
              selectedTodoId={selectedTodoId}
              selectedEventId={selectedEventId}
              visibleMonth={calendarMonth}
              setVisibleMonth={setCalendarMonth}
              setSelectedDate={setSelectedCalendarDate}
              setSelectedTodoId={setSelectedTodoId}
              setSelectedEventId={setSelectedEventId}
              quickEventTitle={quickEventTitle}
              setQuickEventTitle={setQuickEventTitle}
              handleQuickCreateEvent={handleQuickCreateEvent}
              onSelectTodo={handleSelectTodo}
              onSelectEvent={handleSelectEvent}
              readOnly={isReadOnly}
            />
          ) : activeView === 'board' ? (
            <StatusBoard
              columns={boardColumns}
              categories={activeCategories}
              onUpdateTodoStatus={handleSetTodoStatus}
              enableDrag={!isMobileViewport}
              busy={busy}
              readOnly={isReadOnly}
            />
          ) : activeView === 'stats' ? (
            <StatsBoard
              metricCards={statsMetricCards}
              statusDistribution={statusDistribution}
              categoryDistribution={categoryDistribution}
              dueDistribution={dueDistribution}
              dayLoad={nextSevenDayLoad}
              historicalCompletionSeries={historicalCompletionSeries}
            />
          ) : (
            <TodoBoard
              quickTodoTitle={quickTodoTitle}
              setQuickTodoTitle={setQuickTodoTitle}
              handleQuickCreateTodo={handleQuickCreateTodo}
              visibleTodos={visibleTodos}
              selectedTodoId={selectedTodoId}
              onSelectTodo={handleSelectTodo}
              categories={activeCategories}
              handleToggleTodo={handleToggleTodo}
              showCategoryMeta={shouldShowTodoCategoryMeta}
              readOnly={isReadOnly}
            />
          )}
        </section>

        {isMobileViewport ? (
          activeView !== 'board' && activeView !== 'stats' && (selectedTodo || selectedEvent) && isMobileDetailOpen ? (
            <div className="mobile-detail-layer">
              <button
                type="button"
                className="mobile-detail-backdrop"
                aria-label="关闭详情"
                onClick={() => closeDetail(true)}
              />
              <div className="mobile-detail-sheet" role="dialog" aria-modal="true" aria-label="移动端任务详情">
                <div className="mobile-detail-sheet-chrome">
                  <div className="mobile-detail-sheet-handle" aria-hidden="true" />
                  <button
                    type="button"
                    className="detail-close mobile-detail-close"
                    aria-label="关闭详情"
                    onClick={() => closeDetail(true)}
                >
                  ×
                </button>
              </div>
                {selectedTodo ? (
                  <TodoDetailPane
                    selectedTodo={selectedTodo}
                    categories={activeCategories}
                    detailDraft={detailDraft}
                    setDetailDraft={setDetailDraft}
                    handleDeleteTodo={handleDeleteTodo}
                    confirmDeleteTodo={confirmDeleteTodo}
                    setConfirmDeleteTodo={setConfirmDeleteTodo}
                    closeDetail={() => closeDetail(true)}
                    busy={busy}
                    className="detail-pane detail-pane-sheet"
                    showCloseButton={false}
                    readOnly={isReadOnly}
                  />
                ) : (
                  <EventDetailPane
                    selectedEvent={selectedEvent}
                    eventDraft={eventDraft}
                    setEventDraft={setEventDraft}
                    handleDeleteEvent={handleDeleteEvent}
                    confirmDeleteEvent={confirmDeleteEvent}
                    setConfirmDeleteEvent={setConfirmDeleteEvent}
                    closeDetail={() => closeDetail(true)}
                    busy={busy}
                    className="detail-pane detail-pane-sheet"
                    showCloseButton={false}
                    readOnly={isReadOnly}
                  />
                )}
              </div>
            </div>
          ) : null
        ) : activeView === 'calendar' ? (
          selectedTodo ? (
            <TodoDetailPane
              selectedTodo={selectedTodo}
              categories={activeCategories}
              detailDraft={detailDraft}
              setDetailDraft={setDetailDraft}
              handleDeleteTodo={handleDeleteTodo}
              confirmDeleteTodo={confirmDeleteTodo}
              setConfirmDeleteTodo={setConfirmDeleteTodo}
              closeDetail={() => closeDetail(false)}
              busy={busy}
              readOnly={isReadOnly}
            />
          ) : selectedEvent ? (
            <EventDetailPane
              selectedEvent={selectedEvent}
              eventDraft={eventDraft}
              setEventDraft={setEventDraft}
              handleDeleteEvent={handleDeleteEvent}
              confirmDeleteEvent={confirmDeleteEvent}
              setConfirmDeleteEvent={setConfirmDeleteEvent}
              closeDetail={() => closeDetail(false)}
              busy={busy}
              readOnly={isReadOnly}
            />
          ) : null
        ) : activeView === 'stats' ? null : !shouldShowDesktopTodoDetail ? null : (
          <TodoDetailPane
            selectedTodo={selectedTodo}
            categories={activeCategories}
            detailDraft={detailDraft}
            setDetailDraft={setDetailDraft}
            handleDeleteTodo={handleDeleteTodo}
            confirmDeleteTodo={confirmDeleteTodo}
            setConfirmDeleteTodo={setConfirmDeleteTodo}
            closeDetail={() => closeDetail(false)}
            busy={busy}
            readOnly={isReadOnly}
          />
        )}
      </main>

      <AppToastViewport toast={toast} onClose={dismissToast} />

      <WorkspaceAccessDialog
        open={workspaceDialogOpen}
        workspaceMode={workspaceMode}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        setWorkspaceMode={setWorkspaceMode}
        handleWorkspaceSubmit={handleWorkspaceSubmit}
        enterGuestMode={enterGuestMode}
        busy={busy}
        message={message}
        closeDialog={closeWorkspaceDialog}
      />

      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        info={workspaceSettingsInfo}
        busyState={workspaceSettingsBusyState}
        message={workspaceSettingsMessage}
        passphraseDraft={workspacePassphraseDraft}
        setPassphraseDraft={setWorkspacePassphraseDraft}
        passphraseConfirm={workspacePassphraseConfirm}
        setPassphraseConfirm={setWorkspacePassphraseConfirm}
        confirmLeaveWorkspace={confirmLeaveWorkspace}
        setConfirmLeaveWorkspace={setConfirmLeaveWorkspace}
        hasSyncRisk={hasWorkspaceSettingsSyncRisk}
        handleUpdatePassphrase={handleUpdateWorkspacePassphrase}
        handleLeaveWorkspace={handleLeaveWorkspace}
        closeDialog={closeWorkspaceSettings}
      />
    </>
  )
}

function SyncActionButton({
  syncSnapshot,
  onClick,
  disabled,
}: {
  syncSnapshot: WorkspaceSyncSnapshot | null
  onClick: () => void
  disabled: boolean
}) {
  const status = syncSnapshot?.status ?? 'idle'
  const isSyncing = status === 'pushing' || status === 'pulling'
  const hasError = status === 'error'
  const pendingCount = syncSnapshot?.pendingOutboxCount ?? 0
  const label = formatSyncActionLabel(syncSnapshot)

  return (
    <button
      type="button"
      className={[
        'sync-action-button',
        isSyncing ? 'is-syncing' : '',
        hasError ? 'has-error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      disabled={disabled || isSyncing}
      onClick={onClick}
    >
      <RefreshCw size={18} strokeWidth={2.15} aria-hidden="true" />
      {pendingCount > 0 ? (
        <span className="sync-action-badge" aria-hidden="true">
          {pendingCount > 99 ? '99+' : pendingCount}
        </span>
      ) : null}
    </button>
  )
}

function AppToastViewport({
  toast,
  onClose,
}: {
  toast: AppToast | null
  onClose: () => void
}) {
  if (!toast) {
    return null
  }

  return (
    <div className="app-toast-viewport" aria-live="assertive" aria-atomic="true">
      <section className="app-toast app-toast-error" role="alert">
        <div className="app-toast-copy">
          <strong>操作失败</strong>
          <p>{toast.message}</p>
        </div>
        <button type="button" className="app-toast-close" aria-label="关闭提示" onClick={onClose}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </section>
    </div>
  )
}

function WorkspaceAccessDialog({
  open,
  workspaceMode,
  passphrase,
  setPassphrase,
  setWorkspaceMode,
  handleWorkspaceSubmit,
  enterGuestMode,
  busy,
  message,
  closeDialog,
}: {
  open: boolean
  workspaceMode: WorkspaceMode
  passphrase: string
  setPassphrase: (value: string) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  handleWorkspaceSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  enterGuestMode: () => void
  busy: boolean
  message: string
  closeDialog: () => void
}) {
  if (!open) {
    return null
  }

  return (
    <div className="category-dialog-backdrop workspace-dialog-backdrop" role="presentation" onClick={closeDialog}>
      <div
        className="category-dialog workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="category-dialog-head workspace-dialog-head">
          <h3 id="workspace-dialog-title">创建或加入你的任务工作台</h3>
          <button type="button" className="detail-close" aria-label="关闭工作区对话框" onClick={closeDialog}>
            ×
          </button>
        </div>

        <form className="category-dialog-form workspace-form workspace-dialog-form" onSubmit={handleWorkspaceSubmit}>
          <div className="workspace-dialog-mode-row">
            <div className="segmented workspace-dialog-segmented" aria-label="工作区接入方式">
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
                加入工作区
              </button>
            </div>
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
              autoFocus
            />
          </label>

          {message ? (
            <p className="workspace-dialog-message" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}

          {!isSupabaseConfigured ? (
            <p className="workspace-dialog-message" role="status" aria-live="polite">
              缺少 Supabase 环境变量，当前仅可查看示例数据。
            </p>
          ) : null}

          <div className="category-dialog-actions category-form-actions workspace-dialog-actions">
            <button className="secondary-button" type="button" onClick={enterGuestMode}>
              游客模式
            </button>
            <button className="primary-button" type="submit" disabled={busy || !isSupabaseConfigured}>
              {busy
                ? '提交中...'
                : workspaceMode === 'create'
                  ? '创建并进入工作台'
                  : '加入并进入工作台'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function WorkspaceSettingsDialog({
  open,
  info,
  busyState,
  message,
  passphraseDraft,
  setPassphraseDraft,
  passphraseConfirm,
  setPassphraseConfirm,
  confirmLeaveWorkspace,
  setConfirmLeaveWorkspace,
  hasSyncRisk,
  handleUpdatePassphrase,
  handleLeaveWorkspace,
  closeDialog,
}: {
  open: boolean
  info: WorkspaceSettingsInfo | null
  busyState: WorkspaceSettingsBusyState
  message: string
  passphraseDraft: string
  setPassphraseDraft: (value: string) => void
  passphraseConfirm: string
  setPassphraseConfirm: (value: string) => void
  confirmLeaveWorkspace: boolean
  setConfirmLeaveWorkspace: (value: boolean) => void
  hasSyncRisk: boolean
  handleUpdatePassphrase: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleLeaveWorkspace: () => Promise<void>
  closeDialog: () => void
}) {
  if (!open) {
    return null
  }

  const loading = busyState === 'loading'
  const updating = busyState === 'updating'
  const leaving = busyState === 'leaving'
  const syncRiskText = info ? getWorkspaceSettingsRiskText(info.syncStatus) : ''

  return (
    <div className="category-dialog-backdrop workspace-dialog-backdrop" role="presentation" onClick={closeDialog}>
      <div
        className="category-dialog workspace-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="category-dialog-head workspace-settings-head">
          <div className="workspace-settings-headcopy">
            <h3 id="workspace-settings-title">工作区设置</h3>
          </div>
          <button type="button" className="detail-close" aria-label="关闭工作区设置" onClick={closeDialog}>
            ×
          </button>
        </div>

        <form className="workspace-settings-section workspace-settings-form" onSubmit={(event) => void handleUpdatePassphrase(event)}>
          <div className="workspace-settings-section-head">
            <strong className="workspace-settings-label">修改口令</strong>
          </div>

          <div className="workspace-settings-form-grid">
            <label>
              <span>新口令</span>
              <input
                value={passphraseDraft}
                onChange={(event) => setPassphraseDraft(event.target.value)}
                placeholder="至少 6 个字符…"
                minLength={6}
                autoComplete="off"
                name="workspaceSettingsNewPassphrase"
              />
            </label>

            <label>
              <span>确认新口令</span>
              <input
                value={passphraseConfirm}
                onChange={(event) => setPassphraseConfirm(event.target.value)}
                placeholder="再次输入新口令…"
                minLength={6}
                autoComplete="off"
                name="workspaceSettingsConfirmPassphrase"
              />
            </label>
          </div>

          <div className="workspace-settings-form-actions">
            <button className="primary-button" type="submit" disabled={updating || leaving || loading || !info}>
              {updating ? '更新中...' : '更新口令'}
            </button>
          </div>
        </form>

        <section className="workspace-settings-section workspace-settings-exit" aria-label="配置工作区">
          <div className="workspace-settings-section-head">
            <strong className="workspace-settings-label">配置工作区</strong>
          </div>

          {info ? (
            <div className="workspace-settings-config-grid">
              <div className="workspace-settings-value-shell">
                <span className="workspace-settings-field-label">工作区 ID</span>
                <strong title={info.workspaceId}>{info.workspaceId}</strong>
              </div>

              <div className="workspace-settings-config-actions">
                {confirmLeaveWorkspace ? (
                  <p className="workspace-settings-confirm" role="status">
                    退出后将返回工作区入口。
                  </p>
                ) : hasSyncRisk && syncRiskText ? (
                  <span className="workspace-settings-badge workspace-settings-badge-warning">{syncRiskText}</span>
                ) : (
                  <span className="workspace-settings-badge">已连接</span>
                )}

                <div className="workspace-settings-config-buttons">
                  {confirmLeaveWorkspace ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setConfirmLeaveWorkspace(false)}
                      disabled={leaving}
                    >
                      取消
                    </button>
                  ) : null}

                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      if (!confirmLeaveWorkspace) {
                        setConfirmLeaveWorkspace(true)
                        return
                      }

                      void handleLeaveWorkspace()
                    }}
                    disabled={leaving || loading}
                  >
                    <LogOut size={16} strokeWidth={2.1} aria-hidden="true" />
                    <span>{leaving ? '退出中...' : confirmLeaveWorkspace ? '确认退出' : '退出工作区'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="workspace-settings-empty">{loading ? '正在读取工作区信息…' : '暂时无法读取工作区信息。'}</p>
          )}
        </section>

        <p className="workspace-settings-message" role="status" aria-live="polite">
          {message || ' '}
        </p>
      </div>
    </div>
  )
}

function WorkspacePrimaryNav({
  activeView,
  setActiveView,
  activeFilter,
  setActiveFilter,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedUncategorized,
  setSelectedUncategorized,
  setSelectedTodoId,
  setSelectedEventId,
  sidebarCounts,
  className,
  onNavigate,
}: WorkspacePrimaryNavProps) {
  return (
    <nav className={className ?? 'sidebar-section sidebar-nav'} aria-label="任务筛选">
      {(
        [
          { id: 'today', label: '我的一天', count: sidebarCounts.today, icon: 'today' },
          { id: 'all', label: '待办箱', count: sidebarCounts.all, icon: 'all' },
        ] as const
      ).map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            activeView === 'todos' && activeFilter === item.id && !selectedCategoryId && !selectedUncategorized
              ? 'sidebar-item active'
              : 'sidebar-item'
          }
          onClick={(event) => {
            event.currentTarget.blur()
            setActiveView('todos')
            setSelectedCategoryId(null)
            setSelectedUncategorized(false)
            setActiveFilter(item.id)
            setSelectedTodoId(null)
            setSelectedEventId(null)
            onNavigate?.()
          }}
        >
          <span className="sidebar-item-main">
            <span className={`sidebar-icon sidebar-icon-${item.icon}`} aria-hidden="true">
              {renderSidebarIcon(item.icon)}
            </span>
            <span>{item.label}</span>
          </span>
          <b>{item.count}</b>
        </button>
      ))}

      <button
        type="button"
        className={activeView === 'board' ? 'sidebar-item active' : 'sidebar-item'}
        onClick={(event) => {
          event.currentTarget.blur()
          setActiveView('board')
          setSelectedCategoryId(null)
          setSelectedUncategorized(false)
          setSelectedTodoId(null)
          setSelectedEventId(null)
          onNavigate?.()
        }}
      >
        <span className="sidebar-item-main">
          <span className="sidebar-icon sidebar-icon-board" aria-hidden="true">
            {renderSidebarIcon('board')}
          </span>
          <span>看板</span>
        </span>
      </button>

      <button
        type="button"
        className={activeView === 'stats' ? 'sidebar-item active' : 'sidebar-item'}
        onClick={(event) => {
          event.currentTarget.blur()
          setActiveView('stats')
          setSelectedCategoryId(null)
          setSelectedUncategorized(false)
          setSelectedTodoId(null)
          setSelectedEventId(null)
          onNavigate?.()
        }}
      >
        <span className="sidebar-item-main">
          <span className="sidebar-icon sidebar-icon-stats" aria-hidden="true">
            {renderSidebarIcon('stats')}
          </span>
          <span>数据统计</span>
        </span>
      </button>

      <button
        type="button"
        className={activeView === 'calendar' ? 'sidebar-item active' : 'sidebar-item'}
        onClick={(event) => {
          event.currentTarget.blur()
          setActiveView('calendar')
          setSelectedCategoryId(null)
          setSelectedUncategorized(false)
          setSelectedTodoId(null)
          setSelectedEventId(null)
          onNavigate?.()
        }}
      >
        <span className="sidebar-item-main">
          <span className="sidebar-icon sidebar-icon-calendar" aria-hidden="true">
            {renderSidebarIcon('calendar')}
          </span>
          <span>日程概览</span>
        </span>
      </button>
    </nav>
  )
}

type SidebarProps = {
  workspaceId: string
  sessionLabel: string
  workspaceLabel: string
  className?: string
  id?: string
} & WorkspacePrimaryNavProps & {
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
  handleReorderCategories: (orderedIds: string[]) => Promise<void>
  handleDeleteCategory: (category?: CategoryRecord) => Promise<void>
  openWorkspaceSettings: () => void
  workspaceSyncSnapshot: WorkspaceSyncSnapshot | null
  handleManualSync: () => Promise<void>
  showWorkspaceControls: boolean
  isGuestMode: boolean
  openWorkspaceDialog: (mode?: WorkspaceMode) => void
  busy: boolean
  readOnly: boolean
}

function Sidebar({ className, id, readOnly, ...props }: SidebarProps) {
  const sidebarClassName = [className ?? 'sidebar-pane', readOnly ? 'is-readonly' : ''].filter(Boolean).join(' ')

  return (
    <aside id={id} className={sidebarClassName}>
      <SidebarContent readOnly={readOnly} {...props} />
    </aside>
  )
}

function SidebarContent({
  sessionLabel,
  workspaceLabel,
  activeView,
  setActiveView,
  activeFilter,
  setActiveFilter,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedUncategorized,
  setSelectedUncategorized,
  setSelectedTodoId,
  setSelectedEventId,
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
  handleReorderCategories,
  handleDeleteCategory,
  openWorkspaceSettings,
  workspaceSyncSnapshot,
  handleManualSync,
  showWorkspaceControls,
  isGuestMode,
  openWorkspaceDialog,
  busy,
  onNavigate,
  readOnly,
}: Omit<SidebarProps, 'className' | 'id'>) {
  const [categoryDialogMode, setCategoryDialogMode] = useState<'create' | 'edit' | null>(null)
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<CategoryRecord | null>(null)
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null)
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null)
  const categoryRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragOrderIdsRef = useRef<string[] | null>(null)
  const draggingCategoryIdRef = useRef<string | null>(null)
  const releaseCategoryDragRef = useRef<(() => void) | null>(null)

  const dialogTitle = categoryDialogMode === 'edit' ? '编辑分类' : '新建分类'
  const renderedCategoryOrder = dragOrderIds ?? categories.map((category) => category.id)
  const renderedCategories = renderedCategoryOrder
    .map((categoryId) => categories.find((category) => category.id === categoryId) ?? null)
    .filter((category): category is CategoryRecord => Boolean(category))

  useEffect(() => () => {
    releaseCategoryDragRef.current?.()
  }, [])

  const finishCategoryDrag = (commit: boolean) => {
    const draggedCategoryId = draggingCategoryIdRef.current
    const nextOrder = dragOrderIdsRef.current

    releaseCategoryDragRef.current?.()
    releaseCategoryDragRef.current = null
    draggingCategoryIdRef.current = null
    dragOrderIdsRef.current = null
    setDraggingCategoryId(null)
    setDragOrderIds(null)

    if (!commit || !draggedCategoryId || !nextOrder) {
      return
    }

    const currentOrder = categories.map((category) => category.id)
    if (areCategoryOrdersEqual(currentOrder, nextOrder)) {
      return
    }

    void handleReorderCategories(nextOrder)
  }

  const handleCategoryDragPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, categoryId: string) => {
    if (busy || readOnly || draggingCategoryIdRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const initialOrder = categories.map((category) => category.id)
    draggingCategoryIdRef.current = categoryId
    dragOrderIdsRef.current = initialOrder
    setDraggingCategoryId(categoryId)
    setDragOrderIds(initialOrder)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const currentDraggedCategoryId = draggingCategoryIdRef.current
      const currentOrder = dragOrderIdsRef.current
      if (!currentDraggedCategoryId || !currentOrder) {
        return
      }

      const siblingIds = currentOrder.filter((id) => id !== currentDraggedCategoryId)
      let insertionIndex = siblingIds.length

      for (let index = 0; index < siblingIds.length; index += 1) {
        const rect = categoryRowRefs.current[siblingIds[index]]?.getBoundingClientRect()
        if (!rect) {
          continue
        }

        if (moveEvent.clientY < rect.top + rect.height / 2) {
          insertionIndex = index
          break
        }
      }

      const nextOrder = [...siblingIds]
      nextOrder.splice(insertionIndex, 0, currentDraggedCategoryId)

      if (!areCategoryOrdersEqual(currentOrder, nextOrder)) {
        dragOrderIdsRef.current = nextOrder
        setDragOrderIds(nextOrder)
      }
    }

    const handlePointerUp = () => {
      finishCategoryDrag(true)
    }

    const handlePointerCancel = () => {
      finishCategoryDrag(false)
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerCancel, { once: true })

    releaseCategoryDragRef.current = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }

  const openCreateDialog = () => {
    if (readOnly) {
      return
    }

    setCategoryDialogMode('create')
  }

  const openEditDialog = (category: CategoryRecord) => {
    if (readOnly) {
      return
    }

    setActiveView('todos')
    setSelectedCategoryId(category.id)
    setSelectedUncategorized(false)
    setActiveFilter('all')
    setCategoryDialogMode('edit')
  }

  const closeCategoryDialog = () => {
    setCategoryDialogMode(null)
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
    <>
      <div className="sidebar-topbar">
        <div className="sidebar-topbar-copy">
          <h2 title={sessionLabel}>{workspaceLabel}</h2>
        </div>
        <div className="sidebar-topbar-actions">
          {showWorkspaceControls ? (
            <>
              <SyncActionButton
                syncSnapshot={workspaceSyncSnapshot}
                onClick={() => void handleManualSync()}
                disabled={busy || !workspaceSyncSnapshot}
              />
              <button
                type="button"
                className="sidebar-icon-button"
                aria-label="打开工作区设置"
                onClick={() => {
                  openWorkspaceSettings()
                  onNavigate?.()
                }}
              >
                <Settings2 size={18} strokeWidth={2.15} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <WorkspacePrimaryNav
        activeView={activeView}
        setActiveView={setActiveView}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        selectedUncategorized={selectedUncategorized}
        setSelectedUncategorized={setSelectedUncategorized}
        setSelectedTodoId={setSelectedTodoId}
        setSelectedEventId={setSelectedEventId}
        sidebarCounts={sidebarCounts}
        onNavigate={onNavigate}
      />

      <section className="sidebar-section sidebar-card sidebar-category-section">
        <div className="section-head">
          <div>
            <span>我的列表</span>
          </div>
          {readOnly ? <span className="sidebar-readonly-tag">只读</span> : null}
          {!readOnly ? (
            <button
              type="button"
              className={categoryDialogMode === 'create' ? 'sidebar-plain-button active' : 'sidebar-plain-button'}
              aria-label="新建分类"
              onClick={openCreateDialog}
            >
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="category-list">
          <div className={selectedUncategorized ? 'category-row active' : 'category-row'}>
            <button
              type="button"
              className={selectedUncategorized ? 'category-item active' : 'category-item'}
              onClick={(event) => {
                event.currentTarget.blur()
                setActiveView('todos')
                setSelectedCategoryId(null)
                setSelectedUncategorized(true)
                setActiveFilter('all')
                setSelectedTodoId(null)
                setSelectedEventId(null)
                onNavigate?.()
              }}
            >
              <span className="color-dot neutral" />
              <span className="category-name">未分类</span>
            </button>
          </div>

          {renderedCategories.map((category) => (
            <div
              key={category.id}
              ref={(node) => {
                categoryRowRefs.current[category.id] = node
              }}
              className={selectedCategoryId === category.id ? 'category-row active' : 'category-row'}
              data-dragging={draggingCategoryId === category.id ? 'true' : undefined}
            >
              <button
                type="button"
                className={selectedCategoryId === category.id ? 'category-item active' : 'category-item'}
                onClick={(event) => {
                  event.currentTarget.blur()
                  setActiveView('todos')
                  setSelectedCategoryId(category.id)
                  setSelectedUncategorized(false)
                  setActiveFilter('all')
                  setSelectedTodoId(null)
                  setSelectedEventId(null)
                  onNavigate?.()
                }}
              >
                <span className="color-dot" style={{ backgroundColor: category.color }} />
                <span className="category-name">{category.name}</span>
              </button>

              {!readOnly ? (
                <>
                  <button
                    type="button"
                    className="category-drag-handle"
                    aria-label={`拖动排序 ${category.name}`}
                    aria-grabbed={draggingCategoryId === category.id}
                    disabled={busy}
                    onPointerDown={(event) => handleCategoryDragPointerDown(event, category.id)}
                  >
                    <GripVertical size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="category-edit-button"
                    aria-label={`编辑分类 ${category.name}`}
                    onClick={() => openEditDialog(category)}
                  >
                    <Pencil size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {isGuestMode ? (
        <section className="sidebar-section sidebar-card workspace-sidebar-section guest-sidebar-section" role="status">
          <div className="guest-sidebar-copy">
            <p className="eyebrow">游客模式</p>
            <strong>当前改动仅保留在本次会话。</strong>
          </div>
          <div className="guest-sidebar-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                openWorkspaceDialog('create')
                onNavigate?.()
              }}
            >
              创建工作区
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                openWorkspaceDialog('join')
                onNavigate?.()
              }}
            >
              加入工作区
            </button>
          </div>
        </section>
      ) : null}

      {!readOnly && categoryDialogMode ? (
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
              <label className="category-name-field">
                <span>名称</span>
                <div className="category-name-input-shell">
                  <input
                    value={categoryDialogMode === 'edit' ? categoryEditorName : newCategoryName}
                    onChange={(event) =>
                      categoryDialogMode === 'edit'
                        ? setCategoryEditorName(event.target.value)
                        : setNewCategoryName(event.target.value)
                    }
                    placeholder="分类名称"
                    name={categoryDialogMode === 'edit' ? 'categoryEditorName' : 'newCategoryName'}
                    autoComplete="off"
                  />
                </div>
              </label>

              {categoryDialogMode === 'create' ? (
                <div className="category-suggestion-row" aria-label="快捷分类名称">
                  {categorySuggestionLabels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="category-suggestion-chip"
                      onClick={() => setNewCategoryName(label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              <label className="category-color-field">
                <span>颜色</span>
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
              </label>

              <div className="category-dialog-actions category-form-actions">
                {categoryDialogMode === 'edit' ? (
                  <>
                    <button
                      className="danger-button category-dialog-delete"
                      type="button"
                      disabled={busy || !selectedCategory}
                      onClick={() => {
                        if (!selectedCategory) {
                          return
                        }

                        setPendingDeleteCategory(selectedCategory)
                        closeCategoryDialog()
                      }}
                    >
                      删除
                    </button>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={busy || !categoryEditorName.trim()}
                    >
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <button className="secondary-button" type="button" onClick={closeCategoryDialog}>
                      取消
                    </button>
                    <button className="primary-button" type="submit" disabled={busy || !newCategoryName.trim()}>
                      添加分类
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {!readOnly && pendingDeleteCategory ? (
        <div className="category-dialog-backdrop" role="presentation" onClick={() => setPendingDeleteCategory(null)}>
          <div
            className="category-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="category-dialog-head">
              <h3 id="category-confirm-title">提示</h3>
              <button
                type="button"
                className="detail-close"
                aria-label="关闭删除分类对话框"
                onClick={() => setPendingDeleteCategory(null)}
              >
                ×
              </button>
            </div>

            <p className="category-confirm-copy">
              删除分类后，该分类下的任务会保留，并自动移动到“未分类”。是否确认删除？
            </p>

            <div className="category-dialog-actions category-confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPendingDeleteCategory(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  void handleDeleteCategory(pendingDeleteCategory)
                  setPendingDeleteCategory(null)
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function TodoBoard({
  quickTodoTitle,
  setQuickTodoTitle,
  handleQuickCreateTodo,
  visibleTodos,
  selectedTodoId,
  onSelectTodo,
  categories,
  handleToggleTodo,
  showCategoryMeta,
  readOnly,
}: {
  quickTodoTitle: string
  setQuickTodoTitle: (value: string) => void
  handleQuickCreateTodo: (event: FormEvent<HTMLFormElement>) => Promise<void>
  visibleTodos: TodoRecord[]
  selectedTodoId: string | null
  onSelectTodo: (todoId: string, trigger?: HTMLElement | null) => void
  categories: CategoryRecord[]
  handleToggleTodo: (todo: TodoRecord) => Promise<void>
  showCategoryMeta: boolean
  readOnly: boolean
}) {
  return (
    <section className={readOnly ? 'todo-board is-readonly' : 'todo-board'}>
      {readOnly ? (
        <div className="readonly-tip">当前为只读示例模式，不能新建任务或切换状态。</div>
      ) : null}
      <form className="quick-create" onSubmit={(event) => void handleQuickCreateTodo(event)}>
        <div className={readOnly ? 'quick-create-shell is-disabled' : 'quick-create-shell'}>
          <span className="quick-create-icon" aria-hidden="true">
            +
          </span>
          <input
            value={quickTodoTitle}
            onChange={(event) => setQuickTodoTitle(event.target.value)}
            placeholder={readOnly ? '游客模式下不可新建任务' : '添加任务'}
            aria-label="快速新建任务"
            name="quickTodoTitle"
            autoComplete="off"
            disabled={readOnly}
          />
        </div>
        <button type="submit" className="sr-only" disabled={readOnly}>
          创建任务
        </button>
      </form>

      {visibleTodos.length ? (
        <div className="todo-list" role="list">
          {visibleTodos.map((todo) => {
            const category = categories.find((item) => item.id === todo.categoryId) ?? null
            const statusMeta = todoStatusMeta[todo.status]
            const dueLabel = formatDueDate(todo.dueDate, todo.status)
            const dueText = dueLabel.label || '—'
            const dueClassName = [
              'todo-due',
              dueLabel.emphasis ? 'is-alert' : '',
              dueLabel.label ? '' : 'is-placeholder',
            ]
              .filter(Boolean)
              .join(' ')
            const noteExcerpt = todo.note.trim().split('\n')[0]
            const hasNoteExcerpt = Boolean(noteExcerpt)

            return (
              <article
                key={todo.id}
                className={[
                  'todo-card',
                  hasNoteExcerpt ? 'has-note' : 'no-note',
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
                  aria-label={readOnly ? `查看任务状态，当前${statusMeta.label}` : `切换任务状态，当前${statusMeta.label}`}
                  onClick={() => {
                    if (readOnly) {
                      return
                    }

                    void handleToggleTodo(todo)
                  }}
                  disabled={readOnly}
                >
                  <span className="todo-status-icon" aria-hidden="true">
                    {renderStatusIcon(todo.status)}
                  </span>
                </button>

                <button
                  type="button"
                  className={hasNoteExcerpt ? 'todo-main' : 'todo-main no-note'}
                  aria-label={`查看任务 ${todo.title}`}
                  onClick={(event) => onSelectTodo(todo.id, event.currentTarget)}
                >
                  <div className="todo-copy">
                    <strong>{todo.title}</strong>
                    {noteExcerpt ? <p className="todo-excerpt">{noteExcerpt}</p> : null}
                  </div>

                  <div className={showCategoryMeta ? 'todo-meta-line' : 'todo-meta-line no-category'}>
                    {showCategoryMeta ? (
                      <span className={category ? 'todo-category' : 'todo-category is-neutral'}>
                        <span
                          className={category ? 'color-dot' : 'color-dot neutral'}
                          style={category ? { backgroundColor: category.color } : undefined}
                        />
                        <span>{category?.name ?? '未分类'}</span>
                      </span>
                    ) : (
                      <span className="todo-category-slot" aria-hidden="true" />
                    )}
                    <span className={dueClassName}>{dueText}</span>
                  </div>
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h2>暂无任务</h2>
        </div>
      )}
    </section>
  )
}

function StatusBoard({
  columns,
  categories,
  onUpdateTodoStatus,
  enableDrag,
  busy,
  readOnly,
}: {
  columns: StatusBoardColumn[]
  categories: CategoryRecord[]
  onUpdateTodoStatus: (todo: TodoRecord, nextStatus: TodoStatus) => Promise<void>
  enableDrag: boolean
  busy: boolean
  readOnly: boolean
}) {
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<BoardStatusColumn | null>(null)
  const columnRefs = useRef<Record<BoardStatusColumn, HTMLElement | null>>({
    not_started: null,
    in_progress: null,
    blocked: null,
  })
  const draggingTodoIdRef = useRef<string | null>(null)
  const dragSourceStatusRef = useRef<BoardStatusColumn | null>(null)
  const dragOverStatusRef = useRef<BoardStatusColumn | null>(null)
  const dragMovedRef = useRef(false)
  const releaseTodoDragRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    releaseTodoDragRef.current?.()
  }, [])

  useEffect(() => {
    if (!draggingTodoId) {
      return
    }

    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    return () => {
      document.body.style.userSelect = previousUserSelect
    }
  }, [draggingTodoId])

  const finishTodoDrag = (todo: TodoRecord, commit: boolean) => {
    const sourceStatus = dragSourceStatusRef.current
    const targetStatus = dragOverStatusRef.current
    const didMove = dragMovedRef.current

    releaseTodoDragRef.current?.()
    releaseTodoDragRef.current = null
    draggingTodoIdRef.current = null
    dragSourceStatusRef.current = null
    dragOverStatusRef.current = null
    dragMovedRef.current = false
    setDraggingTodoId(null)
    setDragOverStatus(null)

    if (!didMove) {
      return
    }

    if (!commit || !sourceStatus || !targetStatus || sourceStatus === targetStatus) {
      return
    }

    void onUpdateTodoStatus(todo, targetStatus)
  }

  const handleTodoDragPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    todo: TodoRecord,
    sourceStatus: BoardStatusColumn,
  ) => {
    if (!enableDrag || busy || readOnly || event.button !== 0 || draggingTodoIdRef.current) {
      return
    }

    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    draggingTodoIdRef.current = todo.id
    dragSourceStatusRef.current = sourceStatus
    dragOverStatusRef.current = sourceStatus
    dragMovedRef.current = false
    setDraggingTodoId(todo.id)
    setDragOverStatus(sourceStatus)

    const resolveTargetStatus = (clientX: number, clientY: number) => {
      for (const status of boardStatuses) {
        const rect = columnRefs.current[status]?.getBoundingClientRect()
        if (!rect) {
          continue
        }

        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return status
        }
      }

      return dragOverStatusRef.current
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextDistance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
      if (!dragMovedRef.current && nextDistance < 6) {
        return
      }

      dragMovedRef.current = true
      const nextStatus = resolveTargetStatus(moveEvent.clientX, moveEvent.clientY)
      if (nextStatus && dragOverStatusRef.current !== nextStatus) {
        dragOverStatusRef.current = nextStatus
        setDragOverStatus(nextStatus)
      }
    }

    const handlePointerUp = () => {
      finishTodoDrag(todo, true)
    }

    const handlePointerCancel = () => {
      finishTodoDrag(todo, false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerCancel, { once: true })

    releaseTodoDragRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }

  return (
    <section className="status-board" aria-label="状态看板">
      <div className="status-board-grid">
        {columns.map((column) => (
          <section
            key={column.status}
            className={`status-column status-column-${column.status}`}
            data-drag-over={enableDrag && dragOverStatus === column.status ? 'true' : undefined}
            ref={(node) => {
              columnRefs.current[column.status] = node
            }}
            style={
              {
                '--status-tone': column.meta.tone,
                '--status-accent': column.meta.accent,
              } as CSSProperties
            }
          >
            <header className="status-column-header">
              <div className="status-column-title-row">
                <span className="status-column-icon" aria-hidden="true">
                  {renderStatusIcon(column.status)}
                </span>
                <h2>{column.meta.label}</h2>
              </div>
              <span className="status-column-count">{column.todos.length}</span>
            </header>

            {column.todos.length ? (
              <div className="status-card-list" role="list">
                {column.todos.map((todo) => {
                  const category = todo.categoryId ? categoryMap.get(todo.categoryId) ?? null : null
                  const dueLabel = formatDueDate(todo.dueDate, todo.status)
                  const dueText = dueLabel.label || '—'
                  const dueClassName = [
                    'status-card-due',
                    dueLabel.emphasis ? 'is-alert' : '',
                    dueLabel.label ? '' : 'is-placeholder',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <div key={todo.id} className="status-todo-card-shell" role="listitem">
                      <article
                        className={[
                          'status-todo-card',
                          enableDrag ? 'is-draggable' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-dragging={enableDrag && draggingTodoId === todo.id ? 'true' : undefined}
                        data-testid={`status-card-${todo.id}`}
                        onPointerDown={
                          enableDrag ? (event) => handleTodoDragPointerDown(event, todo, column.status) : undefined
                        }
                      >
                        <div className="status-card-content">
                          <div className="status-card-row">
                            <strong>{todo.title}</strong>
                            <div className="status-card-meta-line">
                              <span className={category ? 'status-card-category' : 'status-card-category is-neutral'}>
                                <span
                                  className={category ? 'color-dot' : 'color-dot neutral'}
                                  style={category ? { backgroundColor: category.color } : undefined}
                                />
                                <span>{category?.name ?? '未分类'}</span>
                              </span>
                              <span className={dueClassName}>{dueText}</span>
                            </div>
                          </div>
                        </div>
                      </article>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="status-column-empty empty-state">
                <h2>暂无任务</h2>
                <p>当前没有“{column.meta.label}”状态的待办事项。</p>
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  )
}

function StatsBoard({
  metricCards,
  statusDistribution,
  categoryDistribution,
  dueDistribution,
  dayLoad,
  historicalCompletionSeries,
}: {
  metricCards: StatsMetricCard[]
  statusDistribution: StatsDistributionItem[]
  categoryDistribution: StatsDistributionItem[]
  dueDistribution: StatsDistributionItem[]
  dayLoad: StatsDayLoad[]
  historicalCompletionSeries: StatsHistoricalCompletionPoint[]
}) {
  return (
    <section className="stats-board" aria-label="数据统计">
      <div className="stats-grid stats-metrics-grid">
        {metricCards.map((metric) => (
          <article key={metric.label} className="stats-panel stats-metric-card">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="stats-grid stats-main-grid">
        <StatsDistributionCard title="状态分布" items={statusDistribution} />
        <StatsDistributionCard title="分类分布" items={categoryDistribution} emptyLabel="暂无分类任务" />
        <StatsDistributionCard title="日期分布" items={dueDistribution} />
      </div>

      <div className="stats-grid stats-secondary-grid">
        <StatsLineChartCard title="过去 14 天到期任务完成情况" points={historicalCompletionSeries} />
        <StatsTrendCard title="未来 7 天安排密度" dayLoad={dayLoad} />
      </div>
    </section>
  )
}

function StatsDistributionCard({
  title,
  items,
  emptyLabel = '暂无数据',
}: {
  title: string
  items: StatsDistributionItem[]
  emptyLabel?: string
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0)
  const visibleItems = items.filter((item) => item.value > 0)

  return (
    <article className="stats-panel stats-card stats-distribution-card">
      <div className="stats-card-head">
        <h2>{title}</h2>
      </div>
      {visibleItems.length ? (
        <div className="stats-bar-list" role="list">
          {visibleItems.map((item) => {
            const ratio = maxValue ? item.value / maxValue : 0
            const rowClassName = ['stats-bar-row', `tone-${item.tone ?? 'primary'}`].join(' ')
            return (
              <div key={item.id} className={rowClassName} role="listitem">
                <div className="stats-bar-copy">
                  <strong>{item.label}</strong>
                </div>
                <div className="stats-bar-track" aria-hidden="true">
                  <span
                    className="stats-bar-fill"
                    style={
                      {
                        '--stats-bar-width': `${Math.max(ratio * 100, item.value ? 10 : 0)}%`,
                        '--stats-bar-accent': item.accent,
                      } as CSSProperties
                    }
                  />
                </div>
                <b>{item.value}</b>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="stats-empty">{emptyLabel}</div>
      )}
    </article>
  )
}

function StatsLineChartCard({
  title,
  points,
}: {
  title: string
  points: StatsHistoricalCompletionPoint[]
}) {
  const hasData = points.some((point) => point.totalCount > 0)
  const barPoints = points.map((point) => {
    const hasValue = point.totalCount > 0
    const completionRate = point.completionRate ?? 0
    const barHeight = hasValue ? Math.max(completionRate * 100, point.completedCount > 0 ? 12 : 4) : 0

    return {
      ...point,
      hasValue,
      completionRate,
      barHeight,
    }
  })

  return (
    <article className="stats-panel stats-card">
      <div className="stats-card-head stats-card-head-stack">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {hasData ? (
        <>
          <div className="stats-history-chart-shell">
            <div className="stats-history-chart-frame">
              <div className="stats-history-chart-yaxis" aria-hidden="true">
                <span>100%</span>
                <span>50%</span>
                <span>0%</span>
              </div>
              <div className="stats-history-chart-body">
                <div className="stats-history-chart-guides" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="stats-history-chart-bars" role="list" aria-label="过去 14 天到期任务完成率柱状图">
                  {barPoints.map((point) => {
                    const className = [
                      'stats-history-day',
                      point.hasValue ? 'has-value' : 'is-empty',
                      point.hasValue && point.completedCount === 0 ? 'is-zero' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <div
                        key={point.date}
                        className={className}
                        role="listitem"
                        aria-label={
                          point.hasValue
                            ? `${point.date} 完成率 ${formatPercentage(point.completionRate)}，完成 ${point.completedCount} / ${point.totalCount}`
                            : `${point.date} 无到期任务`
                        }
                      >
                        <div className="stats-history-bar-shell" aria-hidden="true">
                          {point.hasValue ? (
                            <span className="stats-history-bar" style={{ height: `${point.barHeight}%` }} />
                          ) : (
                            <span className="stats-history-bar-placeholder" />
                          )}
                        </div>
                        <strong>{point.label}</strong>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="stats-empty">过去 14 天暂无到期任务</div>
      )}
    </article>
  )
}

function StatsTrendCard({
  title,
  dayLoad,
}: {
  title: string
  dayLoad: StatsDayLoad[]
}) {
  const maxCount = Math.max(...dayLoad.flatMap((day) => [day.taskCount, day.eventCount]), 0)
  const scaleMax = Math.max(maxCount, 1)
  const scaleMiddle = scaleMax > 1 ? Math.ceil(scaleMax / 2) : ''

  return (
    <article className="stats-panel stats-card">
      <div className="stats-card-head stats-card-head-stack">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="stats-trend-legend" aria-label="安排密度图例">
        <span className="stats-trend-legend-item">
          <span className="stats-trend-legend-swatch stats-trend-legend-swatch-task" aria-hidden="true" />
          任务
        </span>
        <span className="stats-trend-legend-item">
          <span className="stats-trend-legend-swatch stats-trend-legend-swatch-event" aria-hidden="true" />
          事件
        </span>
      </div>
      <div className="stats-trend-chart-frame">
        <div className="stats-trend-yaxis" aria-hidden="true">
          <span>{scaleMax}</span>
          <span>{scaleMiddle}</span>
          <span>0</span>
        </div>
        <div className="stats-trend-chart-body">
          <div className="stats-trend-guides" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="stats-trend-grid" role="list">
            {dayLoad.map((day) => {
              const taskHeight = maxCount ? Math.max((day.taskCount / maxCount) * 100, day.taskCount ? 12 : 0) : 0
              const eventHeight = maxCount ? Math.max((day.eventCount / maxCount) * 100, day.eventCount ? 12 : 0) : 0

              return (
                <div key={day.date} className="stats-trend-day" role="listitem">
                  <div className="stats-trend-bars" aria-hidden="true">
                    <span className="stats-trend-bar stats-trend-bar-tasks" style={{ height: `${taskHeight}%` }} />
                    <span className="stats-trend-bar stats-trend-bar-events" style={{ height: `${eventHeight}%` }} />
                  </div>
                  <strong>{day.label}</strong>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </article>
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
  className,
  showCloseButton = true,
  readOnly,
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
  className?: string
  showCloseButton?: boolean
  readOnly: boolean
}) {
  const selectedCategory = categories.find((category) => category.id === detailDraft?.categoryId) ?? null
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [showCalendarPicker, setShowCalendarPicker] = useState(false)
  const [visibleCategoryCount, setVisibleCategoryCount] = useState<number | null>(null)
  const categoryStripRef = useRef<HTMLDivElement | null>(null)
  const categoryMeasureRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const dropdownMeasureRef = useRef<HTMLButtonElement | null>(null)
  const orderedCategoryOptions = useMemo(() => {
    const selectedId = detailDraft?.categoryId ?? ''
    const options: CategoryChipOption[] = []
    const consumedIds = new Set<string>()

    if (!selectedId) {
      options.push({
        key: 'uncategorized',
        categoryId: '',
        label: '未分类',
        color: null,
        neutral: true,
      })
    }

    if (selectedCategory) {
      options.push({
        key: selectedCategory.id,
        categoryId: selectedCategory.id,
        label: selectedCategory.name,
        color: selectedCategory.color,
      })
      consumedIds.add(selectedCategory.id)
    }

    for (const category of categories) {
      if (consumedIds.has(category.id)) {
        continue
      }

      options.push({
        key: category.id,
        categoryId: category.id,
        label: category.name,
        color: category.color,
      })
    }

    return options
  }, [categories, detailDraft?.categoryId, selectedCategory])

  useLayoutEffect(() => {
    const strip = categoryStripRef.current
    if (!strip || !orderedCategoryOptions.length) {
      window.requestAnimationFrame(() => {
        setVisibleCategoryCount(null)
      })
      return
    }

    let frame = 0
    const gap = 8
    const computeVisibleCategories = () => {
      const containerWidth = strip.clientWidth
      if (!containerWidth) {
        return
      }

      const chipWidths = orderedCategoryOptions.map(
        (option) => categoryMeasureRefs.current[option.key]?.offsetWidth ?? 0,
      )
      const totalChipWidth = chipWidths.reduce(
        (sum, width, index) => sum + width + (index > 0 ? gap : 0),
        0,
      )

      if (totalChipWidth <= containerWidth) {
        setVisibleCategoryCount(orderedCategoryOptions.length)
        return
      }

      const dropdownWidth = dropdownMeasureRef.current?.offsetWidth ?? 34
      const availableWidth = Math.max(containerWidth - dropdownWidth - gap, 0)
      let usedWidth = 0
      let nextVisibleCount = 0

      for (const width of chipWidths) {
        const projectedWidth = nextVisibleCount === 0 ? width : usedWidth + gap + width
        if (projectedWidth > availableWidth) {
          break
        }

        usedWidth = projectedWidth
        nextVisibleCount += 1
      }

      setVisibleCategoryCount(Math.max(1, nextVisibleCount))
    }

    frame = window.requestAnimationFrame(computeVisibleCategories)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(computeVisibleCategories)
    })
    observer.observe(strip)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [orderedCategoryOptions])

  const visibleCategoryOptions =
    visibleCategoryCount === null
      ? orderedCategoryOptions
      : orderedCategoryOptions.slice(0, visibleCategoryCount)
  const overflowCategoryOptions =
    visibleCategoryCount === null
      ? []
      : orderedCategoryOptions.slice(visibleCategoryCount)
  const isCategoryPickerOpen = showCategoryPicker && overflowCategoryOptions.length > 0

  const customDateSelected = Boolean(
    detailDraft?.dueDate &&
      detailDraft.dueDate !== todayDate() &&
      detailDraft.dueDate !== nextDate(1),
  )
  const calendarButtonLabel =
    customDateSelected && detailDraft?.dueDate
      ? formatMonthDay(detailDraft.dueDate)
      : '选择日期'
  const myDayMembership = detailDraft
    ? getMyDayMembership({
        dueDate: detailDraft.dueDate || null,
        myDayDate: detailDraft.myDayDate || null,
        status: detailDraft.status,
      })
    : 'none'
  const recurrenceOptions = detailDraft
    ? [
        { type: 'none' as const, label: '不重复', disabled: false },
        { type: 'daily' as const, label: '每天', disabled: !detailDraft.dueDate },
        {
          type: 'weekly' as const,
          label: formatRecurrenceOptionLabel('weekly', detailDraft.dueDate),
          disabled: !detailDraft.dueDate,
        },
        {
          type: 'monthly' as const,
          label: formatRecurrenceOptionLabel('monthly', detailDraft.dueDate),
          disabled: !detailDraft.dueDate,
        },
      ]
    : []
  const detailStatusOptions: TodoStatus[] = ['not_started', 'in_progress', 'completed', 'blocked', 'canceled']
  const detailPaneClassName = [
    className ?? 'detail-pane',
    selectedTodo ? 'is-open' : '',
    readOnly ? 'is-readonly' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (readOnly) {
    const readonlyDueDate = selectedTodo?.dueDate ? formatCalendarFullDate(selectedTodo.dueDate) : '未设置截止日期'
    const readonlyMyDay = selectedTodo
      ? getMyDayMembership({
          dueDate: selectedTodo.dueDate,
          myDayDate: selectedTodo.myDayDate,
          status: selectedTodo.status,
        })
      : 'none'

    return (
      <aside className={detailPaneClassName} aria-label="任务详情">
        {selectedTodo && detailDraft ? (
          <>
            <div className="detail-head detail-head-compact">
              <div className="detail-readonly-badge">只读详情</div>
              {showCloseButton ? (
                <button
                  className="detail-close"
                  onClick={() => {
                    setShowCategoryPicker(false)
                    setShowCalendarPicker(false)
                    closeDetail()
                  }}
                  aria-label="关闭详情"
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="detail-scroll">
              <div className="detail-stack detail-stack-ordered">
                <div className="detail-title-shell detail-title-shell-flat detail-static-shell">
                  <h2 className="detail-static-title">{selectedTodo.title}</h2>
                </div>

                <section className="detail-section detail-section-tight" aria-label="任务状态">
                  <div className="detail-card-head">
                    <span>状态</span>
                  </div>
                  <div className="detail-status-grid">
                    {detailStatusOptions.map((status) => {
                      const statusMeta = todoStatusMeta[status]
                      const isActive = selectedTodo.status === status

                      return (
                        <div
                          key={status}
                          className={isActive ? 'detail-status-choice active' : 'detail-status-choice'}
                          style={
                            isActive
                              ? ({
                                  '--detail-status-tone': statusMeta.tone,
                                  '--detail-status-accent': statusMeta.accent,
                                } as CSSProperties)
                              : undefined
                          }
                        >
                          <span className="detail-status-choice-icon" aria-hidden="true">
                            {renderStatusIcon(status)}
                          </span>
                          <span>{statusMeta.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="detail-section detail-section-tight" aria-label="任务分类">
                  <div className="detail-card-head">
                    <span>分类</span>
                  </div>
                  <div className="detail-category-strip detail-category-strip-readonly">
                    {orderedCategoryOptions.map((option) => {
                      const isActive = selectedTodo.categoryId === option.categoryId

                      return (
                        <div
                          key={option.key}
                          className={[
                            isActive ? 'detail-category-chip active' : 'detail-category-chip',
                            option.neutral ? 'neutral' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={
                            {
                              '--chip-tone': option.color ?? '#dfe6eb',
                            } as CSSProperties
                          }
                        >
                          {option.label}
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="detail-section detail-section-tight" aria-label="日期信息">
                  <div className="detail-card-head">
                    <span>日期</span>
                  </div>
                  <div className="detail-readonly-group">
                    <p className="detail-readonly-value">{readonlyDueDate}</p>
                    <p className="detail-readonly-subtle">
                      {readonlyMyDay === 'auto'
                        ? '会自动出现在“我的一天”中'
                        : readonlyMyDay === 'manual'
                          ? '已手动加入“我的一天”'
                          : '未加入“我的一天”'}
                    </p>
                  </div>
                </section>

                <section className="detail-section detail-section-tight" aria-label="重复设置">
                  <div className="detail-card-head">
                    <span>重复</span>
                  </div>
                  <p className="detail-readonly-value">
                    {formatReadonlyRecurrenceLabel(selectedTodo.recurrenceType, selectedTodo.dueDate)}
                  </p>
                </section>

                <section className="detail-section detail-section-tight" aria-label="备注">
                  <div className="detail-card-head">
                    <span>描述</span>
                  </div>
                  <p className={selectedTodo.note.trim() ? 'detail-readonly-note' : 'detail-readonly-note is-empty'}>
                    {selectedTodo.note.trim() || '暂无备注'}
                  </p>
                </section>
              </div>
            </div>

            <div className="detail-footer detail-footer-left">
              <p className="detail-footer-hint">示例数据仅用于预览，不支持编辑、删除或同步。</p>
            </div>
          </>
        ) : (
          <div className="detail-empty">
            <h2>点开一条任务，右侧会展示示例详情。</h2>
            <p>游客模式下详情仅供阅读，不支持编辑与删除。</p>
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className={detailPaneClassName} aria-label="任务详情">
      {selectedTodo && detailDraft ? (
        <>
          <div className="detail-head detail-head-compact">
            {myDayMembership === 'auto' ? (
              <div className="detail-myday-pill is-auto" aria-label="我的一天状态">
                <Sun size={15} strokeWidth={2.1} />
                <span>我的一天</span>
              </div>
            ) : (
              <button
                className={myDayMembership === 'manual' ? 'detail-myday-pill is-active' : 'detail-myday-pill'}
                onClick={() =>
                  setDetailDraft({
                    ...detailDraft,
                    myDayDate: myDayMembership === 'manual' ? '' : todayDate(),
                  })
                }
                disabled={busy || (isTodoTerminalStatus(detailDraft.status) && myDayMembership === 'none')}
                type="button"
              >
                <Sun size={15} strokeWidth={2.1} />
                <span>我的一天</span>
              </button>
            )}
            {showCloseButton ? (
              <button
                className="detail-close"
                onClick={() => {
                  setShowCategoryPicker(false)
                  setShowCalendarPicker(false)
                  closeDetail()
                }}
                aria-label="关闭详情"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="detail-scroll">
            <div className="detail-stack detail-stack-ordered">
              <div className="detail-title-shell detail-title-shell-flat">
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
              </div>

              <section className="detail-section detail-section-tight" aria-label="状态选择">
                <div className="detail-card-head">
                  <span>状态</span>
                </div>
                <div className="detail-status-grid">
                  {detailStatusOptions.map((status) => {
                    const statusMeta = todoStatusMeta[status]
                    const isActive = detailDraft.status === status
                    return (
                      <button
                        key={status}
                        type="button"
                        className={isActive ? 'detail-status-choice active' : 'detail-status-choice'}
                        style={
                          isActive
                            ? ({
                                '--detail-status-tone': statusMeta.tone,
                                '--detail-status-accent': statusMeta.accent,
                              } as CSSProperties)
                            : undefined
                        }
                        onClick={() =>
                          setDetailDraft({
                            ...detailDraft,
                            status,
                          })
                        }
                      >
                        <span className="detail-status-choice-icon" aria-hidden="true">
                          {renderStatusIcon(status)}
                        </span>
                        <span>{statusMeta.label}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="detail-section detail-section-tight" aria-label="任务分类">
                <div className="detail-card-head">
                  <span>分类</span>
                </div>
                <div className="detail-list-picker">
                  <div ref={categoryStripRef} className="detail-category-strip" aria-label="任务分类">
                    {visibleCategoryOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={
                          [
                            detailDraft.categoryId === option.categoryId
                              ? 'detail-category-chip active'
                              : 'detail-category-chip',
                            option.neutral ? 'neutral' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')
                        }
                        style={
                          {
                            '--chip-tone': option.color ?? '#dfe6eb',
                          } as CSSProperties
                        }
                        onClick={() =>
                          setDetailDraft({
                            ...detailDraft,
                            categoryId: option.categoryId,
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}

                    {overflowCategoryOptions.length ? (
                      <button
                        type="button"
                        className="detail-list-select"
                        aria-haspopup="listbox"
                        aria-expanded={isCategoryPickerOpen}
                        onClick={() => setShowCategoryPicker((current) => !current)}
                      >
                        <ChevronDown size={14} strokeWidth={2.2} className="detail-list-arrow" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <div className="detail-category-measure" aria-hidden="true">
                    {orderedCategoryOptions.map((option) => (
                      <button
                        key={option.key}
                        ref={(node) => {
                          categoryMeasureRefs.current[option.key] = node
                        }}
                        type="button"
                        className={[
                          detailDraft.categoryId === option.categoryId
                            ? 'detail-category-chip active'
                            : 'detail-category-chip',
                          option.neutral ? 'neutral' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          {
                            '--chip-tone': option.color ?? '#dfe6eb',
                          } as CSSProperties
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                    <button ref={dropdownMeasureRef} type="button" className="detail-list-select" tabIndex={-1}>
                      <ChevronDown size={14} strokeWidth={2.2} className="detail-list-arrow" aria-hidden="true" />
                    </button>
                  </div>

                  {isCategoryPickerOpen ? (
                    <div className="detail-list-menu" role="listbox" aria-label="分类列表">
                      {overflowCategoryOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={detailDraft.categoryId === option.categoryId ? 'active' : ''}
                          onClick={() => {
                            setDetailDraft({
                              ...detailDraft,
                              categoryId: option.categoryId,
                            })
                            setShowCategoryPicker(false)
                          }}
                        >
                          <span
                            className={option.neutral ? 'detail-list-dot neutral' : 'detail-list-dot'}
                            style={option.neutral ? undefined : { backgroundColor: option.color ?? '#cfd8e3' }}
                            aria-hidden="true"
                          />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="detail-section detail-section-tight" aria-label="截止日期设置">
                <div className="detail-card-head">
                  <span>截止日期</span>
                </div>
                <div className="detail-date-actions" aria-label="日期操作">
                  <button
                    type="button"
                    className={detailDraft.dueDate === todayDate() ? 'detail-date-pill active' : 'detail-date-pill'}
                    onClick={() => {
                      setShowCalendarPicker(false)
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: todayDate(),
                      })
                    }}
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    className={detailDraft.dueDate === nextDate(1) ? 'detail-date-pill active' : 'detail-date-pill'}
                    onClick={() => {
                      setShowCalendarPicker(false)
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: nextDate(1),
                      })
                    }}
                  >
                    明天
                  </button>
                  <div className="detail-date-picker-wrap">
                    <button
                      type="button"
                      className={showCalendarPicker || customDateSelected ? 'detail-date-pill active' : 'detail-date-pill'}
                      onClick={() => setShowCalendarPicker((current) => !current)}
                    >
                      <span>{calendarButtonLabel}</span>
                      <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
                    </button>

                    {showCalendarPicker ? (
                      <div className="detail-calendar-popover">
                        <DayPicker
                          mode="single"
                          locale={zhCN}
                          showOutsideDays
                          selected={detailDraft.dueDate ? new Date(`${detailDraft.dueDate}T00:00:00`) : undefined}
                          onSelect={(date) => {
                            if (!date) {
                              return
                            }

                            setDetailDraft({
                              ...detailDraft,
                              dueDate: formatDateInputValue(date),
                            })
                            setShowCalendarPicker(false)
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={!detailDraft.dueDate ? 'detail-date-pill active' : 'detail-date-pill'}
                    onClick={() => {
                      setShowCalendarPicker(false)
                      setDetailDraft({
                        ...detailDraft,
                        dueDate: '',
                        recurrenceType: 'none',
                      })
                    }}
                  >
                    没有日期
                  </button>
                </div>
              </section>

              <section className="detail-section detail-section-tight" aria-label="重复设置">
                <div className="detail-card-head">
                  <span>重复</span>
                </div>
                <div className="detail-repeat-options" aria-label="重复选项">
                  {recurrenceOptions.map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      className={detailDraft.recurrenceType === option.type ? 'detail-date-pill active' : 'detail-date-pill'}
                      disabled={option.disabled || busy}
                      onClick={() => {
                        if (option.disabled) {
                          return
                        }

                        setDetailDraft({
                          ...detailDraft,
                          recurrenceType: option.type,
                        })
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <label className="detail-field detail-description-field">
                <div className="detail-card-head">
                  <span>描述</span>
                </div>
                <textarea
                  value={detailDraft.note}
                  onChange={(event) =>
                    setDetailDraft({
                      ...detailDraft,
                      note: event.target.value,
                    })
                  }
                  rows={5}
                  placeholder="添加描述"
                  aria-label="备注"
                  name="detailNote"
                  autoComplete="off"
                />
              </label>
            </div>
          </div>

          <div className="detail-footer detail-footer-left">
            {confirmDeleteTodo ? (
              <div className="detail-footer-actions">
                <button className="secondary-button" onClick={() => setConfirmDeleteTodo(false)} type="button">
                  取消
                </button>
                <button className="danger-button" onClick={() => void handleDeleteTodo()} disabled={busy} type="button">
                  删除
                </button>
              </div>
            ) : (
              <div className="detail-footer-actions">
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

function EventDetailPane({
  selectedEvent,
  eventDraft,
  setEventDraft,
  handleDeleteEvent,
  confirmDeleteEvent,
  setConfirmDeleteEvent,
  closeDetail,
  busy,
  className,
  showCloseButton = true,
  readOnly,
}: {
  selectedEvent: EventRecord | null
  eventDraft: EventDraft | null
  setEventDraft: (draft: EventDraft | null) => void
  handleDeleteEvent: () => Promise<void>
  confirmDeleteEvent: boolean
  setConfirmDeleteEvent: (value: boolean) => void
  closeDetail: () => void
  busy: boolean
  className?: string
  showCloseButton?: boolean
  readOnly: boolean
}) {
  const eventStatusOptions: EventStatus[] = ['not_completed', 'completed']
  const detailPaneClassName = [
    className ?? 'detail-pane',
    selectedEvent ? 'is-open' : '',
    readOnly ? 'is-readonly' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (readOnly) {
    return (
      <aside className={detailPaneClassName} aria-label="事件详情">
        {selectedEvent ? (
          <>
            <div className="detail-head detail-head-compact">
              <div className="detail-readonly-badge">只读详情</div>
              {showCloseButton ? (
                <button
                  className="detail-close"
                  onClick={closeDetail}
                  aria-label="关闭详情"
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="detail-scroll">
              <div className="detail-stack detail-stack-ordered">
                <div className="detail-title-shell detail-title-shell-flat detail-static-shell">
                  <h2 className="detail-static-title">{selectedEvent.title}</h2>
                </div>

                <section className="detail-section detail-section-tight" aria-label="日程日期">
                  <div className="detail-card-head">
                    <span>日期</span>
                  </div>
                  <p className="detail-readonly-value">{formatCalendarFullDate(selectedEvent.date)}</p>
                </section>

                <section className="detail-section detail-section-tight" aria-label="事件状态">
                  <div className="detail-card-head">
                    <span>状态</span>
                  </div>
                  <p className="detail-readonly-value">{eventStatusMeta[selectedEvent.status].label}</p>
                </section>

                <section className="detail-section detail-section-tight" aria-label="时间范围">
                  <div className="detail-card-head">
                    <span>时间</span>
                  </div>
                  <p className="detail-readonly-value">
                    {formatEventTimeRange(selectedEvent.startAt, selectedEvent.endAt, selectedEvent.allDay)}
                  </p>
                </section>

                <section className="detail-section detail-section-tight" aria-label="备注">
                  <div className="detail-card-head">
                    <span>描述</span>
                  </div>
                  <p className={selectedEvent.note.trim() ? 'detail-readonly-note' : 'detail-readonly-note is-empty'}>
                    {selectedEvent.note.trim() || '暂无备注'}
                  </p>
                </section>
              </div>
            </div>

            <div className="detail-footer detail-footer-left">
              <p className="detail-footer-hint">示例数据仅用于预览，不支持编辑、删除或同步。</p>
            </div>
          </>
        ) : (
          <div className="detail-empty">
            <h2>点击一条事件，右侧会展示示例详情。</h2>
            <p>游客模式下详情仅供阅读，不支持编辑与删除。</p>
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className={detailPaneClassName} aria-label="事件详情">
      {selectedEvent && eventDraft ? (
        <>
          <div className="detail-head detail-head-compact">
            <div className="detail-myday-pill event-detail-pill" aria-label="日程类型">
              <Clock3 size={15} strokeWidth={2.1} />
              <span>事件</span>
            </div>
            {showCloseButton ? (
              <button className="detail-close" onClick={closeDetail} aria-label="关闭详情" type="button">
                ×
              </button>
            ) : null}
          </div>

          <div className="detail-scroll">
            <div className="detail-stack detail-stack-ordered">
              <div className="detail-title-shell detail-title-shell-flat">
                <input
                  className="detail-title-input"
                  value={eventDraft.title}
                  onChange={(event) =>
                    setEventDraft({
                      ...eventDraft,
                      title: event.target.value,
                    })
                  }
                  placeholder="事件标题…"
                  aria-label="事件标题"
                  name="eventTitle"
                  autoComplete="off"
                />
              </div>

              <label className="detail-field detail-section detail-section-tight" aria-label="事件日期">
                <div className="detail-card-head">
                  <span>日期</span>
                </div>
                <input
                  className="detail-inline-input"
                  type="date"
                  value={eventDraft.date}
                  onChange={(event) =>
                    setEventDraft(
                      normalizeEventDraft({
                        ...eventDraft,
                        date: event.target.value || todayDate(),
                      }),
                    )
                  }
                  aria-label="事件日期"
                />
              </label>

              <section className="detail-section detail-section-tight" aria-label="事件状态">
                <div className="detail-card-head">
                  <span>状态</span>
                </div>
                <div className="detail-status-grid detail-status-grid-binary">
                  {eventStatusOptions.map((status) => {
                    const statusMeta = eventStatusMeta[status]
                    const isActive = eventDraft.status === status
                    return (
                      <button
                        key={status}
                        type="button"
                        className={isActive ? 'detail-status-choice active' : 'detail-status-choice'}
                        style={
                          isActive
                            ? ({
                                '--detail-status-tone': statusMeta.tone,
                                '--detail-status-accent': statusMeta.accent,
                              } as CSSProperties)
                            : undefined
                        }
                        onClick={() =>
                          setEventDraft({
                            ...eventDraft,
                            status,
                          })
                        }
                      >
                        <span className="detail-status-choice-icon" aria-hidden="true">
                          {status === 'completed' ? <CheckCircle2 size={15} strokeWidth={2.1} /> : <Circle size={15} strokeWidth={2.1} />}
                        </span>
                        <span>{statusMeta.label}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="detail-section detail-section-tight" aria-label="事件时间">
                <div className="detail-card-head">
                  <span>时间</span>
                </div>
                <div className="detail-time-stack">
                  <button
                    type="button"
                    className={eventDraft.allDay ? 'detail-myday-pill detail-time-toggle is-active' : 'detail-myday-pill detail-time-toggle'}
                    aria-label="全天"
                    onClick={() =>
                      setEventDraft(
                        normalizeEventDraft({
                          ...eventDraft,
                          allDay: !eventDraft.allDay,
                        }),
                      )
                    }
                    aria-pressed={eventDraft.allDay}
                  >
                    <Clock3 size={15} strokeWidth={2.1} />
                    <span>全天</span>
                  </button>

                  {eventDraft.allDay ? null : (
                    <div className="detail-time-grid">
                      <label className="detail-time-field">
                        <span className="detail-time-field-label">开始时间</span>
                        <input
                          className="detail-inline-input"
                          type="time"
                          value={eventDraft.startTime}
                          onChange={(event) =>
                            setEventDraft(
                              normalizeEventDraft({
                                ...eventDraft,
                                startTime: event.target.value,
                              }),
                            )
                          }
                          aria-label="开始时间"
                        />
                      </label>
                      <label className="detail-time-field">
                        <span className="detail-time-field-label">结束时间</span>
                        <input
                          className="detail-inline-input"
                          type="time"
                          value={eventDraft.endTime}
                          onChange={(event) =>
                            setEventDraft(
                              normalizeEventDraft({
                                ...eventDraft,
                                endTime: event.target.value,
                              }),
                            )
                          }
                          aria-label="结束时间"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </section>

              <label className="detail-field detail-description-field">
                <div className="detail-card-head">
                  <span>描述</span>
                </div>
                <textarea
                  value={eventDraft.note}
                  onChange={(event) =>
                    setEventDraft({
                      ...eventDraft,
                      note: event.target.value,
                    })
                  }
                  rows={5}
                  placeholder="添加描述"
                  aria-label="事件备注"
                  name="eventNote"
                  autoComplete="off"
                />
              </label>
            </div>
          </div>

          <div className="detail-footer detail-footer-left">
            {confirmDeleteEvent ? (
              <div className="detail-footer-actions">
                <button className="secondary-button" onClick={() => setConfirmDeleteEvent(false)} type="button">
                  取消
                </button>
                <button className="danger-button" onClick={() => void handleDeleteEvent()} disabled={busy} type="button">
                  删除
                </button>
              </div>
            ) : (
              <div className="detail-footer-actions">
                <button
                  className="detail-footer-link is-danger"
                  onClick={() => setConfirmDeleteEvent(true)}
                  disabled={busy}
                  type="button"
                >
                  <Trash2 size={15} strokeWidth={2.1} />
                  <span>删除</span>
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="detail-empty">
          <h2>点击一条事件，右侧就会展开详情。</h2>
          <p>这里会承接标题、日期、时间和描述编辑。</p>
        </div>
      )}
    </aside>
  )
}

function CalendarBoard({
  entriesByDate,
  selectedDate,
  selectedTodoId,
  selectedEventId,
  visibleMonth,
  setVisibleMonth,
  setSelectedDate,
  setSelectedTodoId,
  setSelectedEventId,
  quickEventTitle,
  setQuickEventTitle,
  handleQuickCreateEvent,
  onSelectTodo,
  onSelectEvent,
  readOnly,
}: {
  entriesByDate: Map<string, CalendarEntry[]>
  selectedDate: string
  selectedTodoId: string | null
  selectedEventId: string | null
  visibleMonth: string
  setVisibleMonth: (value: string) => void
  setSelectedDate: (value: string) => void
  setSelectedTodoId: (value: string | null) => void
  setSelectedEventId: (value: string | null) => void
  quickEventTitle: string
  setQuickEventTitle: (value: string) => void
  handleQuickCreateEvent: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onSelectTodo: (todoId: string, trigger?: HTMLElement | null) => void
  onSelectEvent: (eventId: string, trigger?: HTMLElement | null) => void
  readOnly: boolean
}) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => getCalendarYear(visibleMonth))
  const expandedPopoverRef = useRef<HTMLDivElement | null>(null)
  const monthPickerRef = useRef<HTMLDivElement | null>(null)
  const cells = useMemo(
    () => buildCalendarCells(visibleMonth, selectedDate, entriesByDate),
    [visibleMonth, selectedDate, entriesByDate],
  )

  useEffect(() => {
    if (!expandedDate && !showMonthPicker) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return
      }

      if (expandedPopoverRef.current?.contains(event.target) || monthPickerRef.current?.contains(event.target)) {
        return
      }

      setExpandedDate(null)
      setShowMonthPicker(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setExpandedDate(null)
      setShowMonthPicker(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [expandedDate, showMonthPicker])

  const focusCalendarDate = (date: string, inCurrentMonth: boolean) => {
    setSelectedDate(date)
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setShowMonthPicker(false)
    if (!inCurrentMonth) {
      setVisibleMonth(startOfMonthIso(date))
    }
  }

  const toggleExpandedDate = (date: string, inCurrentMonth: boolean) => {
    focusCalendarDate(date, inCurrentMonth)
    setExpandedDate((current) => (current === date ? null : date))
  }

  const returnToToday = () => {
    const today = todayDate()
    setVisibleMonth(startOfMonthIso(today))
    setSelectedDate(today)
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setExpandedDate(null)
    setShowMonthPicker(false)
    setPickerYear(getCalendarYear(today))
  }

  const shiftVisibleMonth = (delta: number) => {
    const nextMonth = shiftMonth(visibleMonth, delta)
    setVisibleMonth(nextMonth)
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setExpandedDate(null)
    setShowMonthPicker(false)
  }

  const selectMonth = (monthIndex: number) => {
    const nextMonth = formatCalendarMonthIso(pickerYear, monthIndex)
    setVisibleMonth(nextMonth)
    setSelectedDate(
      selectedDate.slice(0, 7) === nextMonth.slice(0, 7) ? selectedDate : `${nextMonth.slice(0, 7)}-01`,
    )
    setSelectedTodoId(null)
    setSelectedEventId(null)
    setExpandedDate(null)
    setShowMonthPicker(false)
  }

  return (
    <section className="calendar-board">
      <div className="calendar-shell">
        <header className="calendar-toolbar">
          <div className="calendar-toolbar-copy">
            <h1>日程概览</h1>
          </div>

          <div className="calendar-toolbar-controls">
            <div className="calendar-toolbar-actions">
              <button type="button" className="calendar-today-icon" aria-label="回到今天" onClick={returnToToday}>
                <Sun size={20} strokeWidth={2.1} />
              </button>
            </div>

            <div className="calendar-toolbar-main" ref={monthPickerRef}>
              <div className="calendar-month-switcher" aria-label="年月切换">
                <button
                  type="button"
                  className="calendar-nav-button"
                  aria-label="上一个月"
                  onClick={() => shiftVisibleMonth(-1)}
                >
                  <ChevronLeft size={18} strokeWidth={2.2} />
                </button>

                <button
                  type="button"
                  className={showMonthPicker ? 'calendar-month-trigger active' : 'calendar-month-trigger'}
                  aria-label={`选择年月，当前 ${formatCalendarMonthTitle(visibleMonth)}`}
                  aria-expanded={showMonthPicker}
                  onClick={() => {
                    setExpandedDate(null)
                    setPickerYear(getCalendarYear(visibleMonth))
                    setShowMonthPicker((current) => !current)
                  }}
                >
                  <CalendarDays size={18} strokeWidth={2.1} />
                  <span>{formatCalendarMonthTitle(visibleMonth)}</span>
                </button>

                <button
                  type="button"
                  className="calendar-nav-button"
                  aria-label="下一个月"
                  onClick={() => shiftVisibleMonth(1)}
                >
                  <ChevronRight size={18} strokeWidth={2.2} />
                </button>
              </div>

              {showMonthPicker ? (
                <div className="calendar-month-picker" role="dialog" aria-label="选择年月">
                  <div className="calendar-month-picker-head">
                    <button
                      type="button"
                      className="calendar-year-nav"
                      aria-label="上一年"
                      onClick={() => setPickerYear((current) => current - 1)}
                    >
                      <ChevronLeft size={16} strokeWidth={2.2} />
                      <ChevronLeft size={16} strokeWidth={2.2} />
                    </button>
                    <strong>{pickerYear}</strong>
                    <button
                      type="button"
                      className="calendar-year-nav"
                      aria-label="下一年"
                      onClick={() => setPickerYear((current) => current + 1)}
                    >
                      <ChevronRight size={16} strokeWidth={2.2} />
                      <ChevronRight size={16} strokeWidth={2.2} />
                    </button>
                  </div>

                  <div className="calendar-month-grid" role="list">
                    {Array.from({ length: 12 }, (_value, index) => {
                      const monthValue = index + 1
                      const isActive =
                        pickerYear === getCalendarYear(visibleMonth) && monthValue === getCalendarMonthNumber(visibleMonth)

                      return (
                        <button
                          key={monthValue}
                          type="button"
                          className={isActive ? 'calendar-month-option active' : 'calendar-month-option'}
                          onClick={() => selectMonth(monthValue)}
                        >
                          {monthValue}月
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <form className="calendar-quick-create" onSubmit={(event) => void handleQuickCreateEvent(event)}>
            <input
              value={quickEventTitle}
              onChange={(event) => setQuickEventTitle(event.target.value)}
              placeholder={readOnly ? '游客模式下不可新建事件' : `为 ${formatMonthDay(selectedDate)} 添加事件`}
              aria-label="快速新建事件"
              name="quickEventTitle"
              autoComplete="off"
              disabled={readOnly}
            />
            <button
              type="submit"
              className="primary-button calendar-quick-create-button"
              disabled={readOnly || !quickEventTitle.trim()}
            >
              <Plus size={16} strokeWidth={2.2} />
              添加事件
            </button>
          </form>
        </header>

        <div className="calendar-grid-scroll">
          <div className="calendar-weekdays" aria-hidden="true">
            {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="calendar-grid" role="grid" aria-label={formatCalendarMonthTitle(visibleMonth)}>
            {cells.map((cell, index) => {
              const visibleEntries = cell.entries.slice(0, 3)
              const overflowCount = Math.max(cell.entries.length - visibleEntries.length, 0)
              const isExpanded = expandedDate === cell.date
              const columnIndex = index % 7
              const rowIndex = Math.floor(index / 7)
              const popoverClassName = [
                'calendar-day-popover',
                columnIndex >= 5 ? 'align-right' : '',
                rowIndex >= 4 ? 'open-upward' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-selected={cell.isSelected}
                  tabIndex={0}
                  className={[
                    'calendar-cell',
                    cell.inCurrentMonth ? '' : 'is-muted',
                    cell.isToday ? 'is-today' : '',
                    cell.isSelected ? 'is-selected' : '',
                    isExpanded ? 'is-expanded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (overflowCount > 0) {
                      toggleExpandedDate(cell.date, cell.inCurrentMonth)
                      return
                    }

                    focusCalendarDate(cell.date, cell.inCurrentMonth)
                    setExpandedDate(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return
                    }

                    if (event.key !== 'Enter' && event.key !== ' ') {
                      return
                    }

                    event.preventDefault()

                    if (overflowCount > 0) {
                      toggleExpandedDate(cell.date, cell.inCurrentMonth)
                      return
                    }

                    focusCalendarDate(cell.date, cell.inCurrentMonth)
                    setExpandedDate(null)
                  }}
                >
                  <div className="calendar-cell-head">
                    <span className="calendar-cell-day">{formatDayOfMonth(cell.date)}</span>
                  </div>

                  <div className="calendar-cell-items">
                    {visibleEntries.map((entry) => (
                      <CalendarEntryButton
                        key={entry.id}
                        entry={entry}
                        selectedTodoId={selectedTodoId}
                        selectedEventId={selectedEventId}
                        onSelectTodo={(todoId, trigger) => {
                          setSelectedDate(cell.date)
                          onSelectTodo(todoId, trigger)
                          setExpandedDate(null)
                        }}
                        onSelectEvent={(eventId, trigger) => {
                          setSelectedDate(cell.date)
                          onSelectEvent(eventId, trigger)
                          setExpandedDate(null)
                        }}
                        onStopPropagation
                      />
                    ))}

                    {overflowCount ? (
                      <button
                        type="button"
                        className="calendar-item-overflow"
                        aria-label={`查看 ${formatCalendarFullDate(cell.date)} 剩余 ${overflowCount} 项安排`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpandedDate(cell.date, cell.inCurrentMonth)
                        }}
                      >
                        +{overflowCount}
                      </button>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <CalendarDayPopover
                      popoverRef={expandedPopoverRef}
                      className={popoverClassName}
                      date={cell.date}
                      entries={cell.entries}
                      selectedTodoId={selectedTodoId}
                      selectedEventId={selectedEventId}
                      onClose={() => setExpandedDate(null)}
                      onSelectTodo={(todoId, trigger) => {
                        setSelectedDate(cell.date)
                        onSelectTodo(todoId, trigger)
                        setExpandedDate(null)
                      }}
                      onSelectEvent={(eventId, trigger) => {
                        setSelectedDate(cell.date)
                        onSelectEvent(eventId, trigger)
                        setExpandedDate(null)
                      }}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function CalendarEntryButton({
  entry,
  selectedTodoId,
  selectedEventId,
  onSelectTodo,
  onSelectEvent,
  onStopPropagation = false,
  className,
}: {
  entry: CalendarEntry
  selectedTodoId: string | null
  selectedEventId: string | null
  onSelectTodo: (todoId: string, trigger?: HTMLElement | null) => void
  onSelectEvent: (eventId: string, trigger?: HTMLElement | null) => void
  onStopPropagation?: boolean
  className?: string
}) {
  if (entry.kind === 'todo') {
    return (
      <button
        type="button"
        className={[
          'calendar-item',
          className ?? '',
          `status-${entry.todo.status}`,
          selectedTodoId === entry.todo.id ? 'active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={(event) => {
          if (onStopPropagation) {
            event.stopPropagation()
          }
          onSelectTodo(entry.todo.id, event.currentTarget)
        }}
      >
        <span className="calendar-item-title">{entry.todo.title}</span>
      </button>
    )
  }

  const timeLabel = formatEventTimeBadge(entry.event.startAt, entry.event.endAt, entry.event.allDay)

  return (
    <button
      type="button"
      className={[
        'calendar-item',
        'calendar-item-event',
        className ?? '',
        `status-${entry.event.status}`,
        selectedEventId === entry.event.id ? 'active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        if (onStopPropagation) {
          event.stopPropagation()
        }
        onSelectEvent(entry.event.id, event.currentTarget)
      }}
    >
      <span className="calendar-item-row">
        {timeLabel ? <span className="calendar-item-time">{timeLabel}</span> : null}
        <span className="calendar-item-title">{entry.event.title}</span>
      </span>
    </button>
  )
}

function CalendarDayPopover({
  popoverRef,
  className,
  date,
  entries,
  selectedTodoId,
  selectedEventId,
  onClose,
  onSelectTodo,
  onSelectEvent,
}: {
  popoverRef: RefObject<HTMLDivElement | null>
  className: string
  date: string
  entries: CalendarEntry[]
  selectedTodoId: string | null
  selectedEventId: string | null
  onClose: () => void
  onSelectTodo: (todoId: string, trigger?: HTMLElement | null) => void
  onSelectEvent: (eventId: string, trigger?: HTMLElement | null) => void
}) {
  return (
    <div
      ref={popoverRef}
      className={className}
      role="dialog"
      aria-label={`${formatCalendarFullDate(date)} 安排列表`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="calendar-day-popover-head">
        <div>
          <strong>{formatCalendarFullDate(date)}</strong>
          <span>{entries.length} 项安排</span>
        </div>
        <button type="button" className="calendar-day-popover-close" aria-label="关闭当天安排浮层" onClick={onClose}>
          <X size={16} strokeWidth={2.2} />
        </button>
      </div>

      <div className="calendar-day-popover-list">
        {entries.map((entry) => (
          <CalendarEntryButton
            key={entry.id}
            entry={entry}
            selectedTodoId={selectedTodoId}
            selectedEventId={selectedEventId}
            className="calendar-day-popover-item"
            onSelectTodo={onSelectTodo}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  )
}

function todayDate() {
  return formatDateInputValue(new Date())
}

function groupCalendarEntriesByDate(todos: TodoRecord[], events: EventRecord[]) {
  const grouped = new Map<string, CalendarEntry[]>()

  for (const event of events) {
    const items = grouped.get(event.date) ?? []
    items.push({
      id: event.id,
      kind: 'event',
      date: event.date,
      event,
    })
    grouped.set(event.date, items)
  }

  for (const todo of todos) {
    if (!todo.dueDate) {
      continue
    }

    const items = grouped.get(todo.dueDate) ?? []
    items.push({
      id: todo.id,
      kind: 'todo',
      date: todo.dueDate,
      todo,
    })
    grouped.set(todo.dueDate, items)
  }

  for (const [key, value] of grouped.entries()) {
    grouped.set(key, value.sort((left, right) => compareCalendarEntries(left, right)))
  }

  return grouped
}

function buildCalendarCells(
  visibleMonth: string,
  selectedDate: string,
  entriesByDate: Map<string, CalendarEntry[]>,
) {
  const firstOfMonth = new Date(`${visibleMonth}T00:00:00`)
  const gridStart = new Date(firstOfMonth)
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7
  gridStart.setDate(firstOfMonth.getDate() - mondayOffset)

  const cells: CalendarCell[] = []

  for (let index = 0; index < 42; index += 1) {
    const current = new Date(gridStart)
    current.setDate(gridStart.getDate() + index)
    const isoDate = formatDateInputValue(current)

    cells.push({
      date: isoDate,
      inCurrentMonth: isoDate.slice(0, 7) === visibleMonth.slice(0, 7),
      isToday: isoDate === todayDate(),
      isSelected: isoDate === selectedDate,
      entries: entriesByDate.get(isoDate) ?? [],
    })
  }

  return cells
}

function getMyDayMembership(
  todo: Pick<TodoRecord, 'dueDate' | 'myDayDate' | 'status'>,
  targetDate = todayDate(),
) {
  if (isTodoTerminalStatus(todo.status)) {
    return 'none' as const
  }

  if (todo.dueDate && todo.dueDate <= targetDate) {
    return 'auto' as const
  }

  if (todo.myDayDate && todo.myDayDate <= targetDate) {
    return 'manual' as const
  }

  return 'none' as const
}

function isTodoInMyDay(
  todo: Pick<TodoRecord, 'dueDate' | 'myDayDate' | 'status'>,
  targetDate = todayDate(),
) {
  return getMyDayMembership(todo, targetDate) !== 'none'
}

function isIncompleteTodoInMyDay(
  todo: Pick<TodoRecord, 'dueDate' | 'myDayDate' | 'status'>,
  targetDate = todayDate(),
) {
  return isTodoInMyDay(todo, targetDate)
}

function isTodoTerminalStatus(status: TodoStatus) {
  return status === 'completed' || status === 'canceled'
}

function isTodoOverdue(
  todo: Pick<TodoRecord, 'dueDate' | 'status'>,
  targetDate = todayDate(),
) {
  return !isTodoTerminalStatus(todo.status) && Boolean(todo.dueDate) && todo.dueDate! < targetDate
}

function getMyDaySortPriority(
  todo: Pick<TodoRecord, 'dueDate' | 'myDayDate' | 'status'>,
  targetDate = todayDate(),
) {
  if (isTodoOverdue(todo, targetDate)) {
    return 0
  }

  if (!isTodoTerminalStatus(todo.status) && todo.dueDate === targetDate) {
    return 1
  }

  return 2
}

function compareMyDayTodos(left: TodoRecord, right: TodoRecord) {
  const leftPriority = getMyDaySortPriority(left)
  const rightPriority = getMyDaySortPriority(right)

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }

  return compareTodos(left, right)
}

function compareTodos(left: TodoRecord, right: TodoRecord) {
  const leftIsTerminal = isTodoTerminalStatus(left.status)
  const rightIsTerminal = isTodoTerminalStatus(right.status)

  if (leftIsTerminal && !rightIsTerminal) {
    return 1
  }

  if (!leftIsTerminal && rightIsTerminal) {
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

function compareEvents(left: EventRecord, right: EventRecord) {
  if (left.allDay && !right.allDay) {
    return -1
  }

  if (!left.allDay && right.allDay) {
    return 1
  }

  if (left.startAt && right.startAt) {
    return left.startAt.localeCompare(right.startAt) || right.updatedAt.localeCompare(left.updatedAt)
  }

  if (!left.startAt && right.startAt) {
    return -1
  }

  if (left.startAt && !right.startAt) {
    return 1
  }

  return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, 'zh-CN')
}

function compareCalendarEntries(left: CalendarEntry, right: CalendarEntry) {
  if (left.kind === 'event' && right.kind === 'event') {
    return compareEvents(left.event, right.event)
  }

  if (left.kind === 'event') {
    return -1
  }

  if (right.kind === 'event') {
    return 1
  }

  return compareTodos(left.todo, right.todo)
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
    myDayDate: null,
    status: 'not_started',
    completed: false,
    note: '',
    recurrenceType: 'none',
    updatedAt: now,
    deleted: false,
  }
}

function createEventRecord(workspaceId: string, title: string, date: string): EventRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    workspaceId,
    title,
    date,
    status: 'not_completed',
    allDay: true,
    startAt: null,
    endAt: null,
    note: '',
    updatedAt: now,
    deleted: false,
  }
}

function formatDueDate(value: string | null, status: TodoStatus) {
  const shouldEmphasize = !isTodoTerminalStatus(status)

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
      emphasis: shouldEmphasize,
    }
  }

  if (diff === -1) {
    return {
      label: '昨天',
      emphasis: shouldEmphasize,
    }
  }

  if (diff === 0) {
    return {
      label: '今天',
      emphasis: shouldEmphasize,
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

  if (diff < 0 && shouldEmphasize) {
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

function formatCalendarMonthTitle(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`
}

function getCalendarYear(value: string) {
  return new Date(`${value}T00:00:00`).getFullYear()
}

function getCalendarMonthNumber(value: string) {
  return new Date(`${value}T00:00:00`).getMonth() + 1
}

function formatCalendarMonthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function formatCalendarFullDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatDayOfMonth(value: string) {
  return String(new Date(`${value}T00:00:00`).getDate())
}

function formatTimeValue(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatEventTimeBadge(startAt: string | null, endAt: string | null, allDay = false) {
  if (allDay) {
    return '全天'
  }

  if (startAt && endAt) {
    return `${formatTimeValue(startAt)}-${formatTimeValue(endAt)}`
  }

  if (startAt) {
    return formatTimeValue(startAt)
  }

  if (endAt) {
    return formatTimeValue(endAt)
  }

  return ''
}

function formatEventTimeRange(startAt: string | null, endAt: string | null, allDay = false) {
  const badge = formatEventTimeBadge(startAt, endAt, allDay)
  return badge || '未设置时间'
}

function toTimeInputValue(value: string | null) {
  return formatTimeValue(value)
}

function buildEventTimestamp(date: string, time: string) {
  if (!time) {
    return null
  }

  return new Date(`${date}T${time}:00`).toISOString()
}

function normalizeEventDraft(draft: EventDraft): EventDraft {
  if (draft.allDay) {
    return {
      ...draft,
      startTime: '',
      endTime: '',
    }
  }

  if (draft.startTime && draft.endTime && draft.endTime < draft.startTime) {
    return {
      ...draft,
      endTime: draft.startTime,
    }
  }

  return draft
}

function toggleTodoStatus(status: TodoStatus): TodoStatus {
  return nextTodoStatus(status)
}

function nextTodoStatus(status: TodoStatus): TodoStatus {
  const cycle: TodoStatus[] = ['not_started', 'in_progress', 'completed', 'blocked', 'canceled']
  const currentIndex = cycle.indexOf(status)
  return cycle[(currentIndex + 1) % cycle.length]
}

function formatRecurrenceOptionLabel(recurrenceType: Exclude<TodoRecurrenceType, 'none'>, dueDate: string) {
  switch (recurrenceType) {
    case 'daily':
      return '每天'
    case 'weekly':
      return `每周（${formatWeekday(dueDate)}）`
    case 'monthly':
      return `每月（${formatMonthDayOfMonth(dueDate)}）`
  }
}

function formatWeekday(value: string) {
  if (!value) {
    return '周'
  }

  const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdayLabels[new Date(`${value}T00:00:00`).getDay()]
}

function formatMonthDayOfMonth(value: string) {
  if (!value) {
    return '日期'
  }

  return `${new Date(`${value}T00:00:00`).getDate()}日`
}

function formatReadonlyRecurrenceLabel(recurrenceType: TodoRecurrenceType, dueDate: string | null) {
  if (recurrenceType === 'none') {
    return '不重复'
  }

  if (!dueDate) {
    return '不重复'
  }

  return formatRecurrenceOptionLabel(recurrenceType, dueDate)
}

function buildStatsSummary(todos: TodoRecord[], events: EventRecord[]) {
  const today = todayDate()
  const nextSevenDaysEnd = nextDate(6)
  const statusCounts: Record<TodoStatus, number> = {
    not_started: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    canceled: 0,
  }

  let overdueTodos = 0
  let todayFocusTodos = 0
  let upcomingTodos = 0

  for (const todo of todos) {
    statusCounts[todo.status] += 1

    if (isTodoOverdue(todo, today)) {
      overdueTodos += 1
    }

    if (isTodoInMyDay(todo)) {
      todayFocusTodos += 1
    }

    if (todo.dueDate && todo.dueDate >= today && todo.dueDate <= nextSevenDaysEnd) {
      upcomingTodos += 1
    }
  }

  const openTodos = todos.filter((todo) => !isTodoTerminalStatus(todo.status)).length
  const dueBuckets = {
    overdue: 0,
    today: 0,
    nextSevenDays: 0,
    later: 0,
    noDate: 0,
  }

  for (const todo of todos) {
    if (!todo.dueDate) {
      dueBuckets.noDate += 1
      continue
    }

    if (isTodoOverdue(todo, today)) {
      dueBuckets.overdue += 1
      continue
    }

    if (todo.dueDate === today) {
      dueBuckets.today += 1
      continue
    }

    if (todo.dueDate <= nextSevenDaysEnd) {
      dueBuckets.nextSevenDays += 1
      continue
    }

    dueBuckets.later += 1
  }

  const upcomingEvents = events.filter((event) => event.date >= today && event.date <= nextSevenDaysEnd).length

  return {
    totalTodos: todos.length,
    completedTodos: statusCounts.completed,
    openTodos,
    overdueTodos,
    todayFocusTodos,
    totalEvents: events.length,
    upcomingScheduledItems: upcomingTodos + upcomingEvents,
    completionRate: todos.length ? statusCounts.completed / todos.length : 0,
    statusCounts,
    dueBuckets,
  }
}

function buildCategoryDistribution(todos: TodoRecord[], categories: CategoryRecord[]): StatsDistributionItem[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const counts = new Map<string, StatsDistributionItem>()

  for (const todo of todos) {
    const category = todo.categoryId ? categoryMap.get(todo.categoryId) ?? null : null
    const key = category?.id ?? 'uncategorized'
    const current = counts.get(key)

    if (current) {
      current.value += 1
      continue
    }

    counts.set(key, {
      id: key,
      label: category?.name ?? '未分类',
      value: 1,
      accent: '#1f6e66',
      tone: 'primary',
    })
  }

  return Array.from(counts.values()).sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'zh-CN'))
}

function buildUpcomingDayLoad(todos: TodoRecord[], events: EventRecord[]): StatsDayLoad[] {
  const eventCountByDate = new Map<string, number>()
  for (const event of events) {
    eventCountByDate.set(event.date, (eventCountByDate.get(event.date) ?? 0) + 1)
  }

  const todoCountByDate = new Map<string, number>()
  for (const todo of todos) {
    if (!todo.dueDate) {
      continue
    }

    todoCountByDate.set(todo.dueDate, (todoCountByDate.get(todo.dueDate) ?? 0) + 1)
  }

  const today = new Date(`${todayDate()}T00:00:00`)
  const result: StatsDayLoad[] = []

  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(today)
    current.setDate(today.getDate() + offset)
    const date = formatDateInputValue(current)
    result.push({
      date,
      label: offset === 0 ? '今天' : formatDayOfMonth(date),
      taskCount: todoCountByDate.get(date) ?? 0,
      eventCount: eventCountByDate.get(date) ?? 0,
    })
  }

  return result
}

function buildHistoricalCompletionSeries(todos: TodoRecord[]): StatsHistoricalCompletionPoint[] {
  const totalsByDate = new Map<string, { totalCount: number; completedCount: number }>()

  for (const todo of todos) {
    if (!todo.dueDate) {
      continue
    }

    const current = totalsByDate.get(todo.dueDate) ?? { totalCount: 0, completedCount: 0 }
    current.totalCount += 1
    if (todo.status === 'completed') {
      current.completedCount += 1
    }
    totalsByDate.set(todo.dueDate, current)
  }

  const today = new Date(`${todayDate()}T00:00:00`)
  const result: StatsHistoricalCompletionPoint[] = []

  for (let offset = 13; offset >= 0; offset -= 1) {
    const current = new Date(today)
    current.setDate(today.getDate() - offset)
    const date = formatDateInputValue(current)
    const counts = totalsByDate.get(date)
    const totalCount = counts?.totalCount ?? 0
    const completedCount = counts?.completedCount ?? 0

    result.push({
      date,
      label: formatDayOfMonth(date),
      totalCount,
      completedCount,
      completionRate: totalCount ? completedCount / totalCount : null,
    })
  }

  return result
}

function formatPercentage(value: number) {
  return `${Math.round(value * 100)}%`
}

function createNextRecurringTodo(baseTodo: TodoRecord, updatedAt: string): TodoRecord | null {
  const nextDueDate = getNextRecurringDueDate(baseTodo.dueDate, baseTodo.recurrenceType)
  if (!nextDueDate) {
    return null
  }

  return {
    ...baseTodo,
    id: crypto.randomUUID(),
    dueDate: nextDueDate,
    myDayDate: null,
    status: 'not_started',
    completed: false,
    updatedAt,
    deleted: false,
  }
}

function getNextRecurringDueDate(
  dueDate: string | null,
  recurrenceType: TodoRecurrenceType,
) {
  if (!dueDate || recurrenceType === 'none') {
    return null
  }

  const baseDate = new Date(`${dueDate}T00:00:00`)

  if (recurrenceType === 'daily') {
    baseDate.setDate(baseDate.getDate() + 1)
    return formatDateInputValue(baseDate)
  }

  if (recurrenceType === 'weekly') {
    baseDate.setDate(baseDate.getDate() + 7)
    return formatDateInputValue(baseDate)
  }

  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()
  const day = baseDate.getDate()
  const targetMonthDate = new Date(year, month + 2, 0)
  const nextMonthLastDay = targetMonthDate.getDate()
  const nextMonthDate = new Date(year, month + 1, Math.min(day, nextMonthLastDay))
  return formatDateInputValue(nextMonthDate)
}

function nextDate(days: number) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return formatDateInputValue(next)
}

function startOfMonthIso(value: string) {
  return `${value.slice(0, 7)}-01`
}

function shiftMonth(value: string, delta: number) {
  const monthDate = new Date(`${value}T00:00:00`)
  monthDate.setMonth(monthDate.getMonth() + delta, 1)
  return formatDateInputValue(monthDate)
}

function diffDaysFromToday(value: string) {
  const current = new Date(`${todayDate()}T00:00:00`).getTime()
  const target = new Date(`${value}T00:00:00`).getTime()
  return Math.round((target - current) / 86400000)
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function renderStatusIcon(status: TodoStatus) {
  switch (status) {
    case 'in_progress':
      return <PlayCircle size={28} strokeWidth={1.9} />
    case 'completed':
      return <CheckCircle2 size={28} strokeWidth={1.9} />
    case 'blocked':
      return <PauseCircle size={28} strokeWidth={1.9} />
    case 'canceled':
      return <Ban size={28} strokeWidth={1.9} />
    default:
      return <Circle size={28} strokeWidth={1.9} />
  }
}

function renderSidebarIcon(icon: 'today' | 'all' | 'board' | 'stats' | 'calendar') {
  switch (icon) {
    case 'today':
      return <Sun size={18} strokeWidth={2.15} />
    case 'board':
      return <SquareKanban size={18} strokeWidth={2.15} />
    case 'stats':
      return <BarChart3 size={18} strokeWidth={2.15} />
    case 'calendar':
      return <CalendarDays size={18} strokeWidth={2.15} />
    default:
      return <Inbox size={18} strokeWidth={2.15} />
  }
}

function formatSyncActionLabel(syncSnapshot: WorkspaceSyncSnapshot | null) {
  if (!syncSnapshot) {
    return '读取同步状态中'
  }

  if (syncSnapshot.status === 'pushing') {
    return '正在推送本地变更'
  }

  if (syncSnapshot.status === 'pulling') {
    return '正在拉取最新数据'
  }

  if (syncSnapshot.status === 'error') {
    return '同步异常'
  }

  if (syncSnapshot.pendingOutboxCount > 0) {
    return `立即同步，当前有 ${syncSnapshot.pendingOutboxCount} 项待同步变更`
  }

  return '立即同步'
}

function normalizeSyncErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase()

  if (
    normalizedMessage.includes('当前设备会话已失效') ||
    normalizedMessage.includes('session') ||
    normalizedMessage.includes('row-level security')
  ) {
    return '当前设备会话已失效，请重新加入工作区。'
  }

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('fetch')
  ) {
    return '同步失败，请检查网络后重试。'
  }

  return message
}

function normalizeWorkspacePassphraseUpdateError(message: string) {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes('already exists')) {
    return '该工作区口令已被其他工作区使用，请更换一个新的口令。'
  }

  if (normalizedMessage.includes('access denied')) {
    return '当前设备没有修改这个工作区口令的权限。'
  }

  if (normalizedMessage.includes('workspace not found')) {
    return '当前工作区不存在或已无法访问。'
  }

  if (normalizedMessage.includes('at least 6 characters')) {
    return '新口令至少需要 6 个字符。'
  }

  return message
}

function getWorkspaceSettingsRiskText(syncStatus: WorkspaceSettingsInfo['syncStatus']) {
  if (syncStatus.status === 'error') {
    return '当前同步异常'
  }

  if (syncStatus.pendingOutboxCount > 0) {
    return '当前有未同步内容'
  }

  return ''
}

function serializeTodoDraft(draft: TodoDraft) {
  return JSON.stringify([
    draft.title.trim(),
    draft.categoryId,
    draft.dueDate,
    draft.myDayDate,
    draft.status,
    draft.note,
    draft.recurrenceType,
  ])
}

function toTodoDraft(todo: TodoRecord): TodoDraft {
  return {
    title: todo.title,
    categoryId: todo.categoryId ?? '',
    dueDate: todo.dueDate ?? '',
    myDayDate: todo.myDayDate ?? '',
    status: todo.status,
    note: todo.note,
    recurrenceType: todo.recurrenceType,
  }
}

function serializeEventDraft(draft: EventDraft) {
  return JSON.stringify([
    draft.title.trim(),
    draft.date,
    draft.status,
    draft.allDay,
    draft.startTime,
    draft.endTime,
    draft.note,
  ])
}

function compareCategories(left: CategoryRecord, right: CategoryRecord) {
  return (
    left.sortOrder - right.sortOrder ||
    left.name.localeCompare(right.name, 'zh-CN') ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
  )
}

function getNextCategorySortOrder(categories: CategoryRecord[]) {
  return categories.reduce((maxSortOrder, category) => Math.max(maxSortOrder, category.sortOrder), -1) + 1
}

function buildReorderedCategories(categories: CategoryRecord[], orderedIds: string[]) {
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  return categories.map((category) =>
    orderMap.has(category.id)
      ? {
          ...category,
          sortOrder: orderMap.get(category.id) ?? category.sortOrder,
        }
      : category,
  )
}

function areCategoryOrdersEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function toSyncCategory(record: CategoryRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    color: record.color,
    sort_order: record.sortOrder,
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
    my_day_date: record.myDayDate,
    status: record.status,
    completed: record.completed,
    note: record.note,
    recurrence_type: record.recurrenceType === 'none' ? null : record.recurrenceType,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

function toSyncEvent(record: EventRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    title: record.title,
    date: record.date,
    status: record.status,
    all_day: record.allDay,
    start_at: record.startAt,
    end_at: record.endAt,
    note: record.note,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

export default App
