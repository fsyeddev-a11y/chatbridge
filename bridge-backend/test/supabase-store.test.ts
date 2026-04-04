import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAppContextSnapshotRows,
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
})
