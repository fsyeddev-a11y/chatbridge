import { describe, expect, it, vi } from 'vitest'

describe('supabase deployment env', () => {
  it('exposes build-time Supabase configuration flags', async () => {
    const module = await import('@/packages/supabase')
    expect(typeof module.isSupabaseConfigured).toBe('boolean')
  })

  it('returns an empty auth header object when no session exists', async () => {
    vi.resetModules()
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: {
              session: null,
            },
          }),
        },
      })),
    }))

    const module = await import('@/packages/supabase')
    expect(await module.getSupabaseAuthHeaders()).toEqual({})
  })
})
