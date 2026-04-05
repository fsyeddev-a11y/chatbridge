import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAppContextSnapshotRows,
  createSupabaseBridgeStore,
  getMissingSeedAllowlistEntries,
  getMissingSeedRegistryEntries,
  getMissingSeedSchoolAllowlistEntries,
} from '../src/supabase-store.js'
import type { AppRegistryEntry, ClassAppAllowlist, SchoolAppAllowlist } from '../src/types.js'

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
  const schoolMemberships = new Map<
    string,
    Array<{ id: string; school_id: string; user_id: string; membership_role: 'school_admin' | 'teacher' | 'student'; created_at: number; removed_at: number | null }>
  >()
  const classMemberships = new Map<
    string,
    Array<{ id: string; class_id: string; user_id: string; membership_role: 'teacher' | 'student'; created_at: number; removed_at: number | null }>
  >()

  const seededApps = [{ app_id: 'chess' }, { app_id: 'weather' }, { app_id: 'google-classroom' }]
  const seededSchools = [{ id: 'demo-school' }]
  const seededSchoolAllowlist = [
    { id: 'demo-school:chess' },
    { id: 'demo-school:weather' },
    { id: 'demo-school:google-classroom' },
  ]
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
              if (table === 'schools') {
                return Promise.resolve({ data: seededSchools, error: null })
              }
              if (table === 'school_allowlists') {
                return Promise.resolve({ data: seededSchoolAllowlist, error: null })
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
              if (table === 'school_memberships') {
                return Promise.resolve({ data: schoolMemberships.get(String(state.user_id)) || [], error: null })
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
          } else if (table === 'school_memberships') {
            const rows = Array.isArray(payload) ? payload : [payload]
            for (const row of rows as Array<{
              id: string
              school_id: string
              user_id: string
              membership_role: 'school_admin' | 'teacher' | 'student'
              created_at: number
              removed_at: number | null
            }>) {
              const existing = schoolMemberships.get(row.user_id) || []
              schoolMemberships.set(
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

function createRegisterAppClient(operationLog: string[]) {
  const schools = new Map<string, Record<string, unknown>>([
    [
      'demo-school',
      {
        id: 'demo-school',
        name: 'Demo School',
        created_at: 1,
        updated_at: 1,
      },
    ],
  ])
  const apps = new Map<string, Record<string, unknown>>([
    [
      'chess',
      {
        app_id: 'chess',
        review_state: 'approved',
        registered_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        active_version: '1.0.0',
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
    ],
    [
      'weather',
      {
        app_id: 'weather',
        review_state: 'approved',
        registered_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        active_version: '1.0.0',
        manifest: {
          appId: 'weather',
          name: 'Weather Dashboard',
          version: '1.0.0',
          description: 'Weather',
          developerName: 'Demo',
          executionModel: 'iframe',
          launchUrl: 'https://weather.example.com',
          allowedOrigins: ['https://weather.example.com'],
          authType: 'none',
          subjectTags: ['Science'],
          gradeBand: 'K-12',
          llmSafeFields: ['location'],
          tools: [{ name: 'weather_tool', description: 'Weather tool' }],
        },
      },
    ],
    [
      'google-classroom',
      {
        app_id: 'google-classroom',
        review_state: 'approved',
        registered_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        active_version: '1.0.0',
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
    ],
  ])
  const appVersions = new Map<string, Record<string, unknown>>([
    [
      'chess:1.0.0',
      {
        id: 'chess:1.0.0',
        app_id: 'chess',
        version: '1.0.0',
        review_state: 'approved',
        submitted_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        manifest: apps.get('chess')?.manifest,
      },
    ],
    [
      'weather:1.0.0',
      {
        id: 'weather:1.0.0',
        app_id: 'weather',
        version: '1.0.0',
        review_state: 'approved',
        submitted_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        manifest: apps.get('weather')?.manifest,
      },
    ],
    [
      'google-classroom:1.0.0',
      {
        id: 'google-classroom:1.0.0',
        app_id: 'google-classroom',
        version: '1.0.0',
        review_state: 'approved',
        submitted_at: 1,
        reviewed_at: 1,
        review_notes: null,
        owner_user_id: 'system-demo',
        owner_email: 'demo@chatbridge.local',
        manifest: apps.get('google-classroom')?.manifest,
      },
    ],
  ])

  return {
    from(table: string) {
      const state: Record<string, unknown> = {}

      const createSelectBuilder = () => ({
        eq(column: string, value: unknown) {
          state[column] = value
          return this
        },
        is(column: string, value: unknown) {
          state[column] = value
          return this
        },
        in(column: string, values: unknown[]) {
          state[column] = values
          return this
        },
        order() {
          return this
        },
        returns() {
          if (table === 'schools') {
            return Promise.resolve({ data: [{ id: 'demo-school' }], error: null })
          }
          if (table === 'classes') {
            return Promise.resolve({ data: [{ id: 'demo-class' }], error: null })
          }
          if (table === 'school_allowlists') {
            return Promise.resolve({
              data: [
                { id: 'demo-school:chess' },
                { id: 'demo-school:weather' },
                { id: 'demo-school:google-classroom' },
              ],
              error: null,
            })
          }
          if (table === 'class_allowlists') {
            return Promise.resolve({
              data: [
                { id: 'demo-class:chess' },
                { id: 'demo-class:weather' },
                { id: 'demo-class:google-classroom' },
              ],
              error: null,
            })
          }
          if (table === 'apps') {
            if (Array.isArray(state.app_id)) {
              const rows = (state.app_id as string[])
                .map((appId) => apps.get(appId))
                .filter(Boolean)
              return Promise.resolve({ data: rows, error: null })
            }
            return Promise.resolve({ data: [{ app_id: 'chess' }, { app_id: 'weather' }, { app_id: 'google-classroom' }], error: null })
          }
          if (table === 'app_versions') {
            if (Array.isArray(state.id)) {
              const rows = (state.id as string[])
                .map((id) => appVersions.get(id))
                .filter(Boolean)
              return Promise.resolve({ data: rows, error: null })
            }
            if (Array.isArray(state.app_id)) {
              const appIds = new Set(state.app_id as string[])
              const rows = [...appVersions.values()].filter((row) => appIds.has(String(row.app_id)))
              return Promise.resolve({ data: rows, error: null })
            }
          }
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          if (table === 'apps') {
            return Promise.resolve({ data: apps.get(String(state.app_id)) || null, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
      })

      return {
        select() {
          return createSelectBuilder()
        },
        upsert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          operationLog.push(`${table}.upsert`)

          if (table === 'schools') {
            const rows = Array.isArray(payload) ? payload : [payload]
            for (const row of rows) {
              schools.set(String(row.id), row)
            }
            return Promise.resolve({ error: null })
          }

          if (table === 'apps') {
            const row = payload as Record<string, unknown>
            apps.set(String(row.app_id), row)
            return Promise.resolve({ error: null })
          }

          if (table === 'app_versions') {
            const row = payload as Record<string, unknown>
            if (!apps.has(String(row.app_id))) {
              return Promise.resolve({ error: new Error('insert or update on table "app_versions" violates foreign key constraint') })
            }
            appVersions.set(String(row.id), row)
            return Promise.resolve({ error: null })
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

  it('backfills only missing demo-school allowlist entries when partially populated', async () => {
    const seedEntries: SchoolAppAllowlist[] = [
      { schoolId: 'demo-school', appId: 'chess', enabledBy: 'school-admin-demo', enabledAt: 1 },
      { schoolId: 'demo-school', appId: 'weather', enabledBy: 'school-admin-demo', enabledAt: 1 },
      { schoolId: 'demo-school', appId: 'google-classroom', enabledBy: 'school-admin-demo', enabledAt: 1 },
    ]

    const missing = await getMissingSeedSchoolAllowlistEntries(
      createSelectClient([{ id: 'demo-school:weather' }]),
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
    const originalSchoolAdminEmails = process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
    const originalTeacherEmails = process.env.CHATBRIDGE_TEACHER_EMAILS
    const originalDeveloperEmails = process.env.CHATBRIDGE_DEVELOPER_EMAILS
    const operationLog: string[] = []

    delete process.env.CHATBRIDGE_ADMIN_EMAILS
    delete process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
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
      const schoolMembershipWriteIndex = operationLog.indexOf('school_memberships.upsert')
      const classMembershipWriteIndex = operationLog.indexOf('class_memberships.upsert')

      assert.notEqual(userProfileWriteIndex, -1)
      assert.notEqual(userRoleWriteIndex, -1)
      assert.notEqual(schoolMembershipWriteIndex, -1)
      assert.notEqual(classMembershipWriteIndex, -1)
      assert.ok(userProfileWriteIndex < userRoleWriteIndex)
      assert.ok(userProfileWriteIndex < schoolMembershipWriteIndex)
      assert.ok(userProfileWriteIndex < classMembershipWriteIndex)
    } finally {
      if (originalAdminEmails === undefined) {
        delete process.env.CHATBRIDGE_ADMIN_EMAILS
      } else {
        process.env.CHATBRIDGE_ADMIN_EMAILS = originalAdminEmails
      }

      if (originalSchoolAdminEmails === undefined) {
        delete process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
      } else {
        process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS = originalSchoolAdminEmails
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

  it('creates the app row before the app version row when registering a brand-new app', async () => {
    const operationLog: string[] = []
    const store = createSupabaseBridgeStore(createRegisterAppClient(operationLog))

    const app = await store.registerApp(
      {
        appId: 'story-builder',
        name: 'AI Story Builder',
        version: '1.0.0',
        description: 'Structured story building for students.',
        developerName: 'Developer',
        executionModel: 'iframe',
        allowedOrigins: ['https://apps.example.com'],
        authType: 'none',
        subjectTags: ['ELA'],
        gradeBand: '3-8',
        llmSafeFields: ['storyTitle'],
        tools: [
          {
            name: 'chatbridge_story_builder_open',
            description: 'Open story builder.',
          },
        ],
      },
      {
        userId: 'developer-1',
        email: 'developer@example.com',
      }
    )

    const appWriteIndex = operationLog.lastIndexOf('apps.upsert')
    const versionWriteIndex = operationLog.lastIndexOf('app_versions.upsert')
    const registeredManifest = app.manifest as { appId: string }

    assert.equal(registeredManifest.appId, 'story-builder')
    assert.equal(app.ownerUserId, 'developer-1')
    assert.notEqual(appWriteIndex, -1)
    assert.notEqual(versionWriteIndex, -1)
    assert.ok(appWriteIndex < versionWriteIndex)
  })

  it('backfills missing school and class memberships when env-based elevated access is added later', async () => {
    const originalSchoolAdminEmails = process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
    const originalTeacherEmails = process.env.CHATBRIDGE_TEACHER_EMAILS
    const operationLog: string[] = []

    delete process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
    delete process.env.CHATBRIDGE_TEACHER_EMAILS

    try {
      const store = createSupabaseBridgeStore(createUserBootstrapClient(operationLog))

      await store.getOrCreateUserProfile({
        userId: 'late-upgrade-user',
        email: 'teacheradmin@example.com',
      })

      assert.deepEqual(
        (await store.listSchoolMembershipsForUser('late-upgrade-user')).map((membership) => membership.membershipRole),
        ['student']
      )
      assert.deepEqual(
        (await store.listClassMembershipsForUser('late-upgrade-user')).map((membership) => membership.membershipRole),
        ['student']
      )

      process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS = 'teacheradmin@example.com'
      process.env.CHATBRIDGE_TEACHER_EMAILS = 'teacheradmin@example.com'

      await store.getOrCreateUserProfile({
        userId: 'late-upgrade-user',
        email: 'teacheradmin@example.com',
      })

      assert.deepEqual(
        (await store.listSchoolMembershipsForUser('late-upgrade-user'))
          .map((membership) => membership.membershipRole)
          .sort(),
        ['school_admin', 'student', 'teacher']
      )
      assert.deepEqual(
        (await store.listClassMembershipsForUser('late-upgrade-user'))
          .map((membership) => membership.membershipRole)
          .sort(),
        ['student', 'teacher']
      )
    } finally {
      if (originalSchoolAdminEmails === undefined) {
        delete process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS
      } else {
        process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS = originalSchoolAdminEmails
      }

      if (originalTeacherEmails === undefined) {
        delete process.env.CHATBRIDGE_TEACHER_EMAILS
      } else {
        process.env.CHATBRIDGE_TEACHER_EMAILS = originalTeacherEmails
      }
    }
  })
})
