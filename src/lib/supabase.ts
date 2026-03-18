import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv, isSupabaseConfigured } from './env'

type WorkspaceMode = 'create' | 'join'

type WorkspaceResponse = {
  workspaceId: string
  joined: boolean
}

type WorkspacePassphraseUpdateResponse = {
  workspaceId: string
  updated: boolean
}

type SessionOptions = {
  expectedUserId?: string | null
  allowAnonymousBootstrap?: boolean
}

const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv()

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

function requireClient() {
  if (!supabase) {
    throw new Error('缺少 Supabase 环境变量，无法连接云端。')
  }

  return supabase
}

export function getSupabaseClient() {
  return requireClient()
}

function createWorkspaceSessionError() {
  return new Error('当前设备会话已失效，请重新加入工作区。')
}

export async function getAuthenticatedSupabaseClient(expectedUserId?: string | null) {
  const client = requireClient()
  await ensureAnonymousSession({
    expectedUserId,
    allowAnonymousBootstrap: !expectedUserId,
  })
  return client
}

export async function ensureAnonymousSession(options: SessionOptions = {}) {
  const client = requireClient()
  const {
    expectedUserId = null,
    allowAnonymousBootstrap = true,
  } = options
  const { data: currentSession, error: sessionError } =
    await client.auth.getSession()

  if (sessionError) {
    throw new Error(`读取会话失败：${sessionError.message}`)
  }

  if (currentSession.session) {
    if (expectedUserId && currentSession.session.user.id !== expectedUserId) {
      throw createWorkspaceSessionError()
    }

    return currentSession.session
  }

  if (!allowAnonymousBootstrap) {
    throw createWorkspaceSessionError()
  }

  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.session) {
    throw new Error(error?.message ?? '匿名登录失败')
  }

  return data.session
}

export async function invokeWorkspaceFunction(
  mode: WorkspaceMode,
  passphrase: string,
) {
  requireClient()
  const functionName = mode === 'create' ? 'workspace-create' : 'workspace-join'
  const session = await ensureAnonymousSession()
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv()

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      passphrase,
    }),
  })

  const text = await response.text()
  let payload: (Partial<WorkspaceResponse> & { error?: string }) | null = null

  if (text) {
    try {
      payload = JSON.parse(text) as Partial<WorkspaceResponse> & { error?: string }
    } catch {
      payload = {
        error: text,
      }
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `函数调用失败，HTTP ${response.status}`)
  }

  if (!payload?.workspaceId) {
    throw new Error('函数未返回 workspaceId')
  }

  return {
    workspaceId: payload.workspaceId,
    joined: Boolean(payload.joined),
  }
}

export async function updateWorkspacePassphrase(
  workspaceId: string,
  newPassphrase: string,
  expectedUserId?: string | null,
) {
  requireClient()
  const session = await ensureAnonymousSession({
    expectedUserId,
    allowAnonymousBootstrap: !expectedUserId,
  })
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv()

  const response = await fetch(`${supabaseUrl}/functions/v1/workspace-update-passphrase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      workspaceId,
      newPassphrase,
    }),
  })

  const text = await response.text()
  let payload: (Partial<WorkspacePassphraseUpdateResponse> & { error?: string }) | null = null

  if (text) {
    try {
      payload = JSON.parse(text) as Partial<WorkspacePassphraseUpdateResponse> & { error?: string }
    } catch {
      payload = {
        error: text,
      }
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `函数调用失败，HTTP ${response.status}`)
  }

  if (!payload?.workspaceId) {
    throw new Error('函数未返回 workspaceId')
  }

  return {
    workspaceId: payload.workspaceId,
    updated: Boolean(payload.updated),
  }
}
