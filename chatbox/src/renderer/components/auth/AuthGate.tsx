import { Alert, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
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
        <Text c="dimmed">Loading TutorMeAI...</Text>
      </div>
    )
  }

  if (isAuthenticated) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Paper withBorder radius="lg" p="xl" maw={420} w="100%">
        <Stack gap="md">
          <div>
            <Title order={2}>TutorMeAI Sign In</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Sign in with the shared internal testing account to access ChatBridge.
            </Text>
          </div>

          {error ? (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          ) : null}

          <TextInput label="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !submitting) {
                void handleLogin()
              }
            }}
          />

          <Button onClick={() => void handleLogin()} loading={submitting} fullWidth>
            Sign In
          </Button>
        </Stack>
      </Paper>
    </div>
  )
}
