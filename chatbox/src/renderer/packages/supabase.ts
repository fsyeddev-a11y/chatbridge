import { createClient } from '@supabase/supabase-js'
import { getDefaultStore } from 'jotai'
import { useEffect, useState } from 'react'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'
import queryClient from '@/stores/queryClient'

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

export function useSupabaseAuthState() {
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      setIsAuthenticated(false)
      return
    }

    let active = true

    const initialize = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!active) {
        return
      }

      setIsAuthenticated(Boolean(session))
      setLoading(false)
    }

    void initialize()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return
      }

      queryClient.removeQueries({
        predicate: (query) => {
          const queryKey = query.queryKey
          return (
            (Array.isArray(queryKey) && queryKey[0] === 'chat-sessions-list') ||
            (Array.isArray(queryKey) && queryKey[0] === 'chat-session')
          )
        },
      })
      if (!session) {
        getDefaultStore().set(currentSessionIdAtom, null)
      }

      setIsAuthenticated(Boolean(session))
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return {
    loading,
    isAuthenticated,
  }
}
