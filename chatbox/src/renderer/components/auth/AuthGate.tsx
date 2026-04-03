import { useEffect, useState } from 'react'
import { supabase } from '@/packages/supabase'

type AuthGateProps = {
  children: React.ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured for this deployment.')
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

      setIsAuthenticated(Boolean(session))
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleLogin = async () => {
    if (!supabase) {
      return
    }

    setSubmitting(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
    }

    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading TutorMeAI...</p>
      </div>
    )
  }

  if (isAuthenticated) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#1f1f23] p-8 shadow-xl">
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold text-white">TutorMeAI Sign In</h1>
            <p className="mt-2 text-sm text-gray-400">
              Sign in with the shared internal testing account to access ChatBridge.
            </p>
          </div>

          {error ? <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-200">Email</span>
            <input
              type="email"
              autoComplete="email"
              className="w-full rounded-xl border border-white/10 bg-[#121216] px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-200">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-[#121216] px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !submitting) {
                  void handleLogin()
                }
              }}
            />
          </label>

          <button
            type="button"
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleLogin()}
            disabled={submitting}
          >
            {submitting ? 'Signing In...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  )
}
