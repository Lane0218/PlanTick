import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv, isSupabaseConfigured } from './env'

type WorkspaceMode = 'create' | 'join'

type WorkspaceResponse = {
  workspaceId: string
  joined: boolean
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

export async function ensureAnonymousSession() {
  const client = requireClient()
  const { data: currentSession, error: sessionError } =
    await client.auth.getSession()

  if (sessionError) {
    throw new Error(`读取会话失败：${sessionError.message}`)
  }

  if (currentSession.session) {
    return currentSession.session
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
  const client = requireClient()
  const functionName = mode === 'create' ? 'workspace-create' : 'workspace-join'

  const { data, error } = await client.functions.invoke<WorkspaceResponse>(
    functionName,
    {
      body: {
        passphrase,
      },
    },
  )

  if (error) {
    throw new Error(error.message)
  }

  if (!data?.workspaceId) {
    throw new Error('函数未返回 workspaceId')
  }

  return data
}
