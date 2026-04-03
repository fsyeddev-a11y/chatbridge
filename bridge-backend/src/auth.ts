import { createClient } from '@supabase/supabase-js'

export type AuthenticatedUser = {
  id: string
  email?: string
}

export type AuthVerifier = (token: string) => Promise<AuthenticatedUser | null>

export function getSupabaseAuthConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

export function isSupabaseAuthEnabled() {
  const config = getSupabaseAuthConfig()
  return Boolean(config.url && config.serviceRoleKey)
}

export function getBearerToken(headerValue: string | undefined) {
  if (!headerValue) {
    return null
  }

  const [scheme, token] = headerValue.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

export function createSupabaseAuthVerifier(): AuthVerifier {
  const { url, serviceRoleKey } = getSupabaseAuthConfig()

  if (!url || !serviceRoleKey) {
    return async () => null
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return async (token: string) => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) {
      return null
    }

    return {
      id: user.id,
      email: user.email,
    }
  }
}
