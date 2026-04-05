import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAppContextSnapshotRows,
  createSupabaseBridgeStore,
  getMissingSeedAllowlistEntries,
  getMissingSeedRegistryEntries,
} from '../src/supabase-store.js'
import type { AppRegistryEntry, ClassAppAllowlist } from '../src/types.js'

function createSelectClient(rows: unknown[]) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              return {
                returns() {
                  return Promise.resolve({ data: rows, error: null })
                },
              }
            },
          }
        },
      }
    },
  } as never
}

function createUserBootstrapClient(operationLog: string[]) {
  const userProfiles = new Map<string, { user_id: string; email: string | null; role: string; created_at: number; updated_at: number }>()
  const userRoles = new Map<string, Array<{ id: string; user_id: string; role: string; assigned_by: string | null; assigned_at: number; revoked_at: number | null }>>()
  const classMemberships = new Map<
    string,
    Array<{ id: string; class_id: string; user_id: string; membership_role: 'teacher' | 'student'; created_at: number; removed_at: number | null }>
  >()

  const seededApps = [{ app_id: 'chess' }, { app_id: 'weather' }, { app_id: 'google-classroom' }]
  const seededAllowlist = [
    { id: 'demo-class:chess' },
    { id: 'demo-class:weather' },
    { id: 'demo-class:google-classroom' },
  ]
  const seededClasses = [{ id: 'demo-class' }]

  return {
    from(table: string) {
      return {
        select() {
          const state: Record<string, unknown> = {}

          const builder = {
            eq(column: string, value: unknown) {
              state[column] = value
              return builder
            },
            is(column: string, value: unknown) {
              state[column] = value
              return builder
            },
            in(column: string, values: unknown[]) {
              state[column] = values
              return builder
            },
            returns() {
              if (table === 'apps') {
                return Promise.resolve({ data: seededApps, error: null })
              }
              if (table === 'class_allowlists') {
                return Promise.resolve({ data: seededAllowlist, error: null })
              }
              if (table === 'classes') {
                return Promise.resolve({ data: seededClasses, error: null })
              }
              if (table === 'user_roles') {
                return Promise.resolve({ data: userRoles.get(String(state.user_id)) || [], error: null })
              }
              if (table === 'class_memberships') {
                return Promise.resolve({ data: classMemberships.get(String(state.user_id)) || [], error: null })
              }
              return Promise.resolve({ data: [], error: null })
            },
            maybeSingle() {
              if (table === 'user_profiles') {
                return Promise.resolve({ data: userProfiles.get(String(state.user_id)) || null, error: null })
              }
              return Promise.resolve({ data: null, error: null })
            },
          }

          return builder
        },
        upsert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          operationLog.push(`${table}.upsert`)

          if (table === 'user_profiles') {
            const row = payload as { user_id: string; email: string | null; role: string; created_at: number; updated_at: number }
            userProfiles.set(row.user_id, row)
          } else if (table === 'user_roles') {
            const rows = Array.isArray(payload) ? payload : [payload]
            for (const row of rows as Array<{
              id: string
              user_id: string
              role: string
              assigned_by: string | null
              assigned_at: number
              revoked_at: number | null
            }>) {
              const existing = userRoles.get(row.user_id) || []
              userRoles.set(
                row.user_id,
                [...existing.filter((entry) => entry.id !== row.id), row]
              )
            }
          } else if (table === 'class_memberships') {
            const row = payload as {
              id: string
              class_id: string
              user_id: string
              membership_role: 'teacher' | 'student'
              created_at: number
              removed_at: number | null
            }
            const existing = classMemberships.get(row.user_id) || []
            classMemberships.set(
              row.user_id,
              [...existing.filter((entry) => entry.id !== row.id), row]
            )
          }

          return Promise.resolve({ error: null })
        },
      }
    },
  } as never
}

describe('supabase seed bootstrap helpers', () => {
  it('backfills only missing default registry entries when the table is partially populated', async () => {
    const seedEntries: AppRegistryEntry[] = [
      {
        reviewState: 'approved',
        registeredAt: 1,
        reviewedAt: 1,
        manifest: {
          appId: 'chess',
          name: 'Chess Coach',
          version: '1.0.0',
          description: 'Chess',
          developerName: 'Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://apps.example.com'],
          authType: 'none',
          subjectTags: ['Strategy'],
          gradeBand: '3-12',
          llmSafeFields: ['fen'],
          tools: [{ name: 'chess_tool', description: 'Chess tool' }],
        },
      },
      {
        reviewState: 'approved',
        registeredAt: 1,
        reviewedAt: 1,
        manifest: {
          appId: 'weather',
          name: 'Weather Dashboard',
          version: '1.0.0',
          description: 'Weather',
          developerName: 'Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://weather.example.com'],
          authType: 'none',
          subjectTags: ['Science'],
          gradeBand: 'K-12',
          llmSafeFields: ['location'],
          tools: [{ name: 'weather_tool', description: 'Weather tool' }],
        },
      },
      {
        reviewState: 'approved',
        registeredAt: 1,
        reviewedAt: 1,
        manifest: {
          appId: 'google-classroom',
          name: 'Google Classroom Assistant',
          version: '1.0.0',
          description: 'Classroom',
          developerName: 'Demo',
          executionModel: 'iframe',
          allowedOrigins: ['https://classroom.example.com'],
          authType: 'oauth2',
          subjectTags: ['Classroom'],
          gradeBand: '3-12',
          llmSafeFields: ['courseCount'],
          tools: [{ name: 'classroom_tool', description: 'Classroom tool' }],
        },
      },
    ]

    const missing = await getMissingSeedRegistryEntries(createSelectClient([{ app_id: 'weather' }]), seedEntries)

    assert.deepEqual(
      missing.map((entry) => entry.manifest.appId).sort(),
      ['chess', 'google-classroom']
    )
  })

  it('backfills only missing demo-class allowlist entries when partially populated', async () => {
    const seedEntries: ClassAppAllowlist[] = [
      { classId: 'demo-class', appId: 'chess', enabledBy: 'teacher-demo', enabledAt: 1 },
      { classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: 1 },
      { classId: 'demo-class', appId: 'google-classroom', enabledBy: 'teacher-demo', enabledAt: 1 },
    ]

    const missing = await getMissingSeedAllowlistEntries(
      createSelectClient([{ id: 'demo-class:weather' }]),
      seedEntries
    )

    assert.deepEqual(
      missing.map((entry) => entry.appId).sort(),
      ['chess', 'google-classroom']
    )
  })

  it('builds snapshot rows for each app context in a bridge session', () => {
    const rows = buildAppContextSnapshotRows(
      'session-1',
      'user-1',
      {
        activeClassId: 'demo-class',
        activeAppId: 'weather',
        appContext: {
          weather: {
            appId: 'weather',
            status: 'active',
            summary: 'Austin is 82F and sunny.',
            lastState: {
              location: 'Austin',
              temperatureF: 82,
            },
          },
          chess: {
            appId: 'chess',
            status: 'complete',
            summary: 'Puzzle solved.',
            lastError: 'Recovered from disconnect.',
          },
        },
      },
      123456
    )

    assert.equal(rows.length, 2)
    assert.deepEqual(rows.find((row) => row.app_id === 'weather'), {
      id: 'session-1:user-1:weather:123456',
      session_id: 'session-1',
      user_id: 'user-1',
      app_id: 'weather',
      status: 'active',
      summary: 'Austin is 82F and sunny.',
      last_state: {
        location: 'Austin',
        temperatureF: 82,
      },
      last_error: null,
      captured_at: 123456,
    })
    assert.deepEqual(rows.find((row) => row.app_id === 'chess'), {
      id: 'session-1:user-1:chess:123456',
      session_id: 'session-1',
      user_id: 'user-1',
      app_id: 'chess',
      status: 'complete',
      summary: 'Puzzle solved.',
      last_state: null,
      last_error: 'Recovered from disconnect.',
      captured_at: 123456,
    })
  })

  it('creates the user profile row before role and class membership bootstrap writes', async () => {
    const originalAdminEmails = process.env.CHATBRIDGE_ADMIN_EMAILS
    const originalTeacherEmails = process.env.CHATBRIDGE_TEACHER_EMAILS
    const originalDeveloperEmails = process.env.CHATBRIDGE_DEVELOPER_EMAILS
    const operationLog: string[] = []

    delete process.env.CHATBRIDGE_ADMIN_EMAILS
    delete process.env.CHATBRIDGE_TEACHER_EMAILS
    delete process.env.CHATBRIDGE_DEVELOPER_EMAILS

    try {
      const store = createSupabaseBridgeStore(createUserBootstrapClient(operationLog))
      const profile = await store.getOrCreateUserProfile({
        userId: 'student-1',
        email: 'student@example.com',
      })

      assert.equal(profile.role, 'student')
      assert.deepEqual(profile.roles, ['student'])
      const userProfileWriteIndex = operationLog.indexOf('user_profiles.upsert')
      const userRoleWriteIndex = operationLog.indexOf('user_roles.upsert')
      const classMembershipWriteIndex = operationLog.indexOf('class_memberships.upsert')

      assert.notEqual(userProfileWriteIndex, -1)
      assert.notEqual(userRoleWriteIndex, -1)
      assert.notEqual(classMembershipWriteIndex, -1)
      assert.ok(userProfileWriteIndex < userRoleWriteIndex)
      assert.ok(userProfileWriteIndex < classMembershipWriteIndex)
    } finally {
      if (originalAdminEmails === undefined) {
        delete process.env.CHATBRIDGE_ADMIN_EMAILS
      } else {
        process.env.CHATBRIDGE_ADMIN_EMAILS = originalAdminEmails
      }

      if (originalTeacherEmails === undefined) {
        delete process.env.CHATBRIDGE_TEACHER_EMAILS
      } else {
        process.env.CHATBRIDGE_TEACHER_EMAILS = originalTeacherEmails
      }

      if (originalDeveloperEmails === undefined) {
        delete process.env.CHATBRIDGE_DEVELOPER_EMAILS
      } else {
        process.env.CHATBRIDGE_DEVELOPER_EMAILS = originalDeveloperEmails
      }
    }
  })
})
