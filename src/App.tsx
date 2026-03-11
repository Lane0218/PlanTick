import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { loadWorkspaceId, runIndexedDbProbe, saveWorkspaceId } from './lib/db'
import { envSummary, isSupabaseConfigured } from './lib/env'
import { ensureAnonymousSession, invokeWorkspaceFunction } from './lib/supabase'

type StatusTone = 'idle' | 'ok' | 'warn' | 'error'

type StatusItem = {
  label: string
  detail: string
  tone: StatusTone
}

type WorkspaceMode = 'create' | 'join'

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

  useEffect(() => {
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

    void runIndexedDbProbe()
      .then(async (probeId) => {
        updateStatus('IndexedDB', `探针写入成功：${probeId}`, 'ok')
        const restoredWorkspaceId = await loadWorkspaceId()
        if (restoredWorkspaceId) {
          setWorkspaceId(restoredWorkspaceId)
          setResultMessage(`已从本地恢复 workspaceId：${restoredWorkspaceId}`)
        }
      })
      .catch((error) => {
        updateStatus(
          'IndexedDB',
          error instanceof Error ? error.message : 'IndexedDB 探针失败',
          'error',
        )
      })

    const handlePwaReady = (
      event: WindowEventMap['plantick:pwa-ready'],
    ) => {
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
      await ensureAnonymousSession()
      updateStatus('匿名会话', '匿名登录成功，可调用受限 Edge Function', 'ok')

      const response = await invokeWorkspaceFunction(workspaceMode, passphrase)
      await saveWorkspaceId(response.workspaceId)
      setWorkspaceId(response.workspaceId)
      setResultMessage(
        `${workspaceMode === 'create' ? '创建' : '加入'}成功，workspaceId = ${response.workspaceId}`,
      )
      updateStatus(
        '工作区 Spike',
        `${workspaceMode === 'create' ? '创建' : '加入'}工作区成功`,
        'ok',
      )
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

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">PlanTick / Phase 0 Spike</p>
          <h1>把 Web、PWA、本地存储和工作区接入一次打通。</h1>
          <p className="hero-body">
            这是第 0 阶段的验证壳，不追求完整产品，而是验证路线是否可靠：
            浏览器可访问、PWA 可安装、IndexedDB 可写入、Supabase 匿名会话可建立、
            `workspace-create` / `workspace-join` 可以形成最小闭环。
          </p>
          <div className="hero-metrics">
            <div>
              <span>验证完成度</span>
              <strong>{completionRatio}</strong>
            </div>
            <div>
              <span>网络状态</span>
              <strong>{navigator.onLine ? '在线' : '离线'}</strong>
            </div>
            <div>
              <span>环境</span>
              <strong>{envSummary}</strong>
            </div>
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

        <article className="card">
          <div className="card-heading">
            <p>Step A</p>
            <h2>云端匿名会话</h2>
          </div>
          <p className="card-body">
            Phase 0 的工作区函数依赖匿名用户上下文。先匿名登录，再调用
            `workspace-create` 或 `workspace-join`。
          </p>
          <button className="primary-button" onClick={handleAnonymousSignIn} disabled={busy}>
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
            当前已经注册 `vite-plugin-pwa`。如果浏览器允许安装，将在这里触发安装提示。
          </p>
          <button
            className="ghost-button"
            onClick={() => void handleInstall()}
            disabled={!installPrompt}
          >
            {installPrompt ? '触发安装提示' : '等待浏览器提供安装入口'}
          </button>
        </article>

        <article className="card card-checklist">
          <div className="card-heading">
            <p>Phase 0 退出条件</p>
            <h2>交付清单</h2>
          </div>
          <ul>
            <li>Windows 浏览器可访问开发服务</li>
            <li>手机浏览器可访问开发服务</li>
            <li>PWA 可以安装并进入独立窗口</li>
            <li>IndexedDB 探针写入成功</li>
            <li>匿名登录成功</li>
            <li>工作区创建 / 加入闭环成立</li>
          </ul>
        </article>
      </section>
    </main>
  )
}

export default App
