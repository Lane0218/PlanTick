import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import './App.css'
import {
  loadWorkspaceId,
  runIndexedDbProbe,
  saveCurrentWorkspaceMeta,
  saveWorkspaceId,
  upsertCategory,
  upsertEvent,
  upsertTodo,
} from './lib/db'
import type { CategoryRecord, EventRecord, TodoRecord } from './lib/local-types'
import { envSummary, isSupabaseConfigured } from './lib/env'
import {
  createCategorySeed,
  createEventSeed,
  createTodoSeed,
  enqueueRecordMutation,
  loadPhaseOneSnapshot,
} from './lib/sync'
import { ensureAnonymousSession, invokeWorkspaceFunction } from './lib/supabase'

type StatusTone = 'idle' | 'ok' | 'warn' | 'error'

type StatusItem = {
  label: string
  detail: string
  tone: StatusTone
}

type WorkspaceMode = 'create' | 'join'

type PhaseOneSnapshot = Awaited<ReturnType<typeof loadPhaseOneSnapshot>>

const initialStatus: StatusItem[] = [
  {
    label: 'PWA 注册',
    detail: '等待 service worker 注册结果',
    tone: 'idle',
  },
  {
    label: '安装能力',
    detail: '等待浏览器安装事件',
    tone: 'idle',
  },
  {
    label: 'IndexedDB',
    detail: '等待本地存储探针',
    tone: 'idle',
  },
  {
    label: 'Supabase 环境',
    detail: isSupabaseConfigured
      ? '已发现 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY'
      : '缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY',
    tone: isSupabaseConfigured ? 'ok' : 'warn',
  },
  {
    label: '匿名会话',
    detail: '等待匿名登录',
    tone: 'idle',
  },
  {
    label: '工作区 Spike',
    detail: '等待调用 workspace-create / workspace-join',
    tone: 'idle',
  },
]

declare global {
  interface WindowEventMap {
    'plantick:pwa-ready': CustomEvent<{ registered: boolean }>
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function App() {
  const [statuses, setStatuses] = useState<StatusItem[]>(initialStatus)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('create')
  const [passphrase, setPassphrase] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [sessionLabel, setSessionLabel] = useState('尚未建立匿名会话')
  const [resultMessage, setResultMessage] = useState('等待第一次验证操作')
  const [busy, setBusy] = useState(false)
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [phaseOneSnapshot, setPhaseOneSnapshot] = useState<PhaseOneSnapshot>(null)

  const updateStatus = (
    label: StatusItem['label'],
    detail: string,
    tone: StatusItem['tone'],
  ) => {
    setStatuses((current) =>
      current.map((item) =>
        item.label === label ? { ...item, detail, tone } : item,
      ),
    )
  }

  const refreshPhaseOneSnapshot = async () => {
    setPhaseOneSnapshot(await loadPhaseOneSnapshot())
  }

  useEffect(() => {
    void runIndexedDbProbe()
      .then(async (probeId) => {
        updateStatus('IndexedDB', `探针写入成功：${probeId}`, 'ok')
        const restoredWorkspaceId = await loadWorkspaceId()
        if (restoredWorkspaceId) {
          setWorkspaceId(restoredWorkspaceId)
          setResultMessage(`已从本地恢复 workspaceId：${restoredWorkspaceId}`)
        }
        await refreshPhaseOneSnapshot()
      })
      .catch((error) => {
        updateStatus(
          'IndexedDB',
          error instanceof Error ? error.message : 'IndexedDB 探针失败',
          'error',
        )
      })

    const handlePwaReady = (event: WindowEventMap['plantick:pwa-ready']) => {
      updateStatus(
        'PWA 注册',
        event.detail.registered ? 'service worker 已注册' : 'service worker 注册失败',
        event.detail.registered ? 'ok' : 'warn',
      )
    }

    const handleBeforeInstallPrompt = (
      event: WindowEventMap['beforeinstallprompt'],
    ) => {
      event.preventDefault()
      setInstallPrompt(event)
      updateStatus('安装能力', '浏览器允许触发安装提示', 'ok')
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      updateStatus('安装能力', 'PWA 已安装到当前设备', 'ok')
    }

    window.addEventListener('plantick:pwa-ready', handlePwaReady)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    if (window.matchMedia('(display-mode: standalone)').matches) {
      updateStatus('安装能力', '当前已在独立 PWA 窗口中运行', 'ok')
    }

    return () => {
      window.removeEventListener('plantick:pwa-ready', handlePwaReady)
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const completionRatio = useMemo(() => {
    const completed = statuses.filter((item) => item.tone === 'ok').length
    return `${completed}/${statuses.length}`
  }, [statuses])

  const handleAnonymousSignIn = async () => {
    if (!isSupabaseConfigured) {
      updateStatus(
        '匿名会话',
        '无法匿名登录，因为 Supabase 环境变量未配置',
        'warn',
      )
      return
    }

    setBusy(true)
    try {
      const session = await ensureAnonymousSession()
      setSessionLabel(
        `匿名会话已建立：${session.user.id.slice(0, 8)} · ${session.access_token.slice(0, 12)}...`,
      )
      updateStatus('匿名会话', '匿名登录成功，可调用受限 Edge Function', 'ok')
      setResultMessage('匿名登录成功，可以继续创建或加入工作区')

      if (workspaceId) {
        await saveCurrentWorkspaceMeta(workspaceId, session.user.id)
      }

      await refreshPhaseOneSnapshot()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '匿名登录失败'
      updateStatus('匿名会话', detail, 'error')
      setResultMessage(detail)
    } finally {
      setBusy(false)
    }
  }

  const handleWorkspaceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (passphrase.trim().length < 6) {
      const detail = '工作区口令至少需要 6 个字符'
      updateStatus('工作区 Spike', detail, 'warn')
      setResultMessage(detail)
      return
    }

    setBusy(true)
    try {
      const session = await ensureAnonymousSession()
      updateStatus('匿名会话', '匿名登录成功，可调用受限 Edge Function', 'ok')

      const response = await invokeWorkspaceFunction(workspaceMode, passphrase)
      await saveWorkspaceId(response.workspaceId)
      await saveCurrentWorkspaceMeta(response.workspaceId, session.user.id)
      setWorkspaceId(response.workspaceId)
      setResultMessage(
        `${workspaceMode === 'create' ? '创建' : '加入'}成功，workspaceId = ${response.workspaceId}`,
      )
      updateStatus(
        '工作区 Spike',
        `${workspaceMode === 'create' ? '创建' : '加入'}工作区成功`,
        'ok',
      )
      await refreshPhaseOneSnapshot()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '工作区请求失败'
      updateStatus('工作区 Spike', detail, 'error')
      setResultMessage(detail)
    } finally {
      setBusy(false)
    }
  }

  const handleInstall = async () => {
    if (!installPrompt) {
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    updateStatus(
      '安装能力',
      choice.outcome === 'accepted' ? '用户接受了安装提示' : '用户关闭了安装提示',
      choice.outcome === 'accepted' ? 'ok' : 'warn',
    )
  }

  const enqueueSeed = async () => {
    if (!workspaceId) {
      setResultMessage('请先创建或加入工作区，再生成本地样本数据。')
      return
    }

    setBusy(true)
    try {
      const category = createCategorySeed(workspaceId)
      const todo = createTodoSeed(workspaceId, category.id)
      const event = createEventSeed(workspaceId)

      await Promise.all([
        upsertCategory(category),
        upsertTodo(todo),
        upsertEvent(event),
      ])

      await Promise.all([
        enqueueRecordMutation('categories', 'upsert', toSyncCategory(category)),
        enqueueRecordMutation('todos', 'upsert', toSyncTodo(todo)),
        enqueueRecordMutation('events', 'upsert', toSyncEvent(event)),
      ])

      setResultMessage('已写入本地 categories/todos/events 样本，并加入 outbox。')
      await refreshPhaseOneSnapshot()
    } finally {
      setBusy(false)
    }
  }

  const shellMetrics = [
    {
      label: '验证完成度',
      value: completionRatio,
    },
    {
      label: '网络状态',
      value: navigator.onLine ? '在线' : '离线',
    },
    {
      label: '环境',
      value: envSummary,
    },
  ]

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">PlanTick / Phase 1 Foundation</p>
          <h1>把第 0 阶段验证壳升级成可持续开发的应用骨架。</h1>
          <p className="hero-body">
            当前页面不再只验证连通性，而是开始承担第 1 阶段职责：
            建立本地数据库 schema、同步契约、工作区恢复上下文和最小路由壳。
          </p>
          <div className="hero-metrics">
            {shellMetrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <aside className="hero-panel">
          <div className="panel-label">当前验证结果</div>
          <div className="panel-title">{resultMessage}</div>
          <div className="panel-foot">
            <span>本地 workspaceId</span>
            <strong>{workspaceId || '尚未创建/加入'}</strong>
          </div>
        </aside>
      </section>

      <nav className="app-nav">
        <NavLink end to="/">
          总览
        </NavLink>
        <NavLink to="/todos">待办骨架</NavLink>
        <NavLink to="/calendar">月历骨架</NavLink>
      </nav>

      <Routes>
        <Route
          path="/"
          element={
            <OverviewRoute
              statuses={statuses}
              sessionLabel={sessionLabel}
              busy={busy}
              workspaceMode={workspaceMode}
              setWorkspaceMode={setWorkspaceMode}
              passphrase={passphrase}
              setPassphrase={setPassphrase}
              handleAnonymousSignIn={handleAnonymousSignIn}
              handleWorkspaceSubmit={handleWorkspaceSubmit}
              handleInstall={handleInstall}
              installPrompt={installPrompt}
              phaseOneSnapshot={phaseOneSnapshot}
              enqueueSeed={enqueueSeed}
            />
          }
        />
        <Route
          path="/todos"
          element={
            <ModuleRoute
              eyebrow="Todo Route"
              title="待办模块骨架已建好，业务列表下一阶段接入。"
              detail="当前路由用于承接分类、待办列表和编辑表单。Phase 1 已经把 local store、outbox 和 workspace 上下文准备好了。"
              snapshot={phaseOneSnapshot}
            />
          }
        />
        <Route
          path="/calendar"
          element={
            <ModuleRoute
              eyebrow="Calendar Route"
              title="月历模块骨架已建好，事件映射和投影下一阶段接入。"
              detail="当前路由用于承接月视图、单日展开和事件编辑。Phase 1 已把 events 表、本地 store 和同步契约预留好。"
              snapshot={phaseOneSnapshot}
            />
          }
        />
      </Routes>
    </main>
  )
}

function OverviewRoute({
  statuses,
  sessionLabel,
  busy,
  workspaceMode,
  setWorkspaceMode,
  passphrase,
  setPassphrase,
  handleAnonymousSignIn,
  handleWorkspaceSubmit,
  handleInstall,
  installPrompt,
  phaseOneSnapshot,
  enqueueSeed,
}: {
  statuses: StatusItem[]
  sessionLabel: string
  busy: boolean
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  passphrase: string
  setPassphrase: (value: string) => void
  handleAnonymousSignIn: () => Promise<void>
  handleWorkspaceSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleInstall: () => Promise<void>
  installPrompt: BeforeInstallPromptEvent | null
  phaseOneSnapshot: PhaseOneSnapshot
  enqueueSeed: () => Promise<void>
}) {
  return (
    <section className="grid">
      <article className="card card-status">
        <div className="card-heading">
          <p>环境状态</p>
          <h2>6 个关键信号</h2>
        </div>
        <div className="status-list">
          {statuses.map((item) => (
            <div className={`status-item tone-${item.tone}`} key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <b>{item.tone}</b>
            </div>
          ))}
        </div>
      </article>

      <article className="card card-checklist">
        <div className="card-heading">
          <p>Phase 1 状态</p>
          <h2>本地数据与同步契约</h2>
        </div>
        {phaseOneSnapshot ? (
          <ul>
            <li>当前工作区：{phaseOneSnapshot.workspaceId}</li>
            <li>匿名用户：{phaseOneSnapshot.anonymousUserId ?? '尚未写入本地 meta'}</li>
            <li>本地分类数：{phaseOneSnapshot.localCounts.categories}</li>
            <li>本地待办数：{phaseOneSnapshot.localCounts.todos}</li>
            <li>本地事件数：{phaseOneSnapshot.localCounts.events}</li>
            <li>待同步 outbox：{phaseOneSnapshot.localCounts.pendingOutbox}</li>
            <li>同步状态：{phaseOneSnapshot.syncStatus}</li>
          </ul>
        ) : (
          <p className="card-body">尚未建立工作区上下文，本地 schema 已初始化但还没有业务数据。</p>
        )}
      </article>

      <article className="card">
        <div className="card-heading">
          <p>Step A</p>
          <h2>云端匿名会话</h2>
        </div>
        <p className="card-body">
          当前匿名会话用于调用受限 Edge Function，同时也是后续按 workspace 成员隔离访问业务表的前提。
        </p>
        <button className="primary-button" onClick={() => void handleAnonymousSignIn()} disabled={busy}>
          {busy ? '处理中...' : '匿名登录并检查 Supabase'}
        </button>
        <div className="inline-note">{sessionLabel}</div>
      </article>

      <article className="card">
        <div className="card-heading">
          <p>Step B</p>
          <h2>工作区接入 Spike</h2>
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

          <button className="secondary-button" type="submit" disabled={busy}>
            {busy
              ? '提交中...'
              : workspaceMode === 'create'
                ? '调用 workspace-create'
                : '调用 workspace-join'}
          </button>
        </form>
      </article>

      <article className="card">
        <div className="card-heading">
          <p>Step C</p>
          <h2>PWA 安装验证</h2>
        </div>
        <p className="card-body">
          第 0 阶段已验证通过，这里保留安装入口，方便在不同设备和浏览器环境下反复检查。
        </p>
        <button
          className="ghost-button"
          onClick={() => void handleInstall()}
          disabled={!installPrompt}
        >
          {installPrompt ? '触发安装提示' : '等待浏览器提供安装入口'}
        </button>
      </article>

      <article className="card">
        <div className="card-heading">
          <p>Step D</p>
          <h2>Phase 1 本地样本</h2>
        </div>
        <p className="card-body">
          这个动作不会写远端数据，只会往 `categories / todos / events / outbox`
          写入最小样本，用来验证第 1 阶段的数据层已经准备好。
        </p>
        <button className="primary-button" onClick={() => void enqueueSeed()} disabled={busy}>
          {busy ? '处理中...' : '写入本地样本并加入 outbox'}
        </button>
      </article>
    </section>
  )
}

function ModuleRoute({
  eyebrow,
  title,
  detail,
  snapshot,
}: {
  eyebrow: string
  title: string
  detail: string
  snapshot: PhaseOneSnapshot
}) {
  return (
    <section className="module-route">
      <article className="card">
        <div className="card-heading">
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p className="card-body">{detail}</p>
        <div className="module-grid">
          <MetricCard label="工作区" value={snapshot?.workspaceId ?? '未进入'} />
          <MetricCard label="分类" value={String(snapshot?.localCounts.categories ?? 0)} />
          <MetricCard label="待办" value={String(snapshot?.localCounts.todos ?? 0)} />
          <MetricCard label="事件" value={String(snapshot?.localCounts.events ?? 0)} />
          <MetricCard
            label="待同步"
            value={String(snapshot?.localCounts.pendingOutbox ?? 0)}
          />
          <MetricCard label="同步状态" value={snapshot?.syncStatus ?? 'idle'} />
        </div>
      </article>
    </section>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
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

function toSyncEvent(record: EventRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    title: record.title,
    date: record.date,
    start_at: record.startAt,
    end_at: record.endAt,
    note: record.note,
    updated_at: record.updatedAt,
    deleted: record.deleted,
  }
}

export default App
