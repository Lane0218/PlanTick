const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const envSummary = isSupabaseConfigured ? 'Supabase 已配置' : '仅本地模式'

export function getSupabaseEnv() {
  return {
    supabaseUrl,
    supabaseAnonKey,
  }
}
