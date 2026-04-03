import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

export async function getSupabaseAccessToken() {
  if (!supabase) {
    return null
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token || null
}

export async function getSupabaseAuthHeaders() {
  const token = await getSupabaseAccessToken()

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {}
}
