import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import queryClient from '@/stores/queryClient'

import {
  disableChatBridgeAppForClass,
  enableChatBridgeAppForClass,
  fetchApprovedChatBridgeAppsForClass,
  fetchChatBridgeAppById,
  fetchChatBridgeAllowlist,
  fetchChatBridgeApps,
  registerChatBridgeApp,
  reviewChatBridgeApp,
} from './registry'

describe('ChatBridge registry backend client', () => {
  const fetchMock = vi.fn()
  let invalidateQueriesSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    invalidateQueriesSpy.mockRestore()
  })

  it('loads apps from the backend and augments them with local mock metadata', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        apps: [
          {
            reviewState: 'approved',
            manifest: {
              appId: 'chess',
              name: 'Chess Coach',
              version: '1.0.0',
              description: 'Backend chess app.',
              developerName: 'Backend',
              executionModel: 'iframe',
              allowedOrigins: ['https://apps.chatbridge.local'],
              authType: 'none',
              subjectTags: ['Strategy'],
              gradeBand: '3-12',
              llmSafeFields: ['phase'],
              tools: [
                {
                  name: 'chatbridge_chess_start_game',
                  description: 'Start a game.',
                },
              ],
            },
          },
        ],
      }),
    })

    const apps = await fetchChatBridgeApps()

    expect(apps).toEqual([
      expect.objectContaining({
        appId: 'chess',
        mockMode: 'chess',
        allowedOrigins: expect.arrayContaining(['https://apps.chatbridge.local', 'null']),
      }),
    ])
  })

  it('keeps real hosted weather apps on their declared origin instead of forcing srcDoc mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        apps: [
          {
            reviewState: 'approved',
            manifest: {
              appId: 'weather',
              name: 'Weather Dashboard',
              version: '1.0.0',
              description: 'Hosted weather app.',
              developerName: 'Backend',
              executionModel: 'iframe',
              launchUrl: 'http://localhost:4173',
              allowedOrigins: ['http://localhost:4173'],
              authType: 'none',
              subjectTags: ['Science'],
              gradeBand: 'K-12',
              llmSafeFields: ['location'],
              tools: [
                {
                  name: 'chatbridge_weather_lookup',
                  description: 'Look up weather.',
                },
              ],
            },
          },
        ],
      }),
    })

    const apps = await fetchChatBridgeApps()

    expect(apps).toEqual([
      expect.objectContaining({
        appId: 'weather',
        launchUrl: 'http://localhost:4173',
        allowedOrigins: ['http://localhost:4173'],
      }),
    ])
  })

  it('falls back to the local registry when the backend is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const apps = await fetchApprovedChatBridgeAppsForClass('demo-class')

    expect(apps.map((app) => app.appId).sort()).toEqual(['chess', 'google-classroom', 'weather'])
  })

  it('resolves a single app by id from the fetched registry', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        apps: [
          {
            reviewState: 'approved',
            manifest: {
              appId: 'weather',
              name: 'Weather Dashboard',
              version: '1.0.0',
              description: 'Backend weather app.',
              developerName: 'Backend',
              executionModel: 'iframe',
              allowedOrigins: ['https://apps.chatbridge.local'],
              authType: 'none',
              subjectTags: ['Science'],
              gradeBand: 'K-12',
              llmSafeFields: ['location'],
              tools: [
                {
                  name: 'chatbridge_weather_lookup',
                  description: 'Look up weather.',
                },
              ],
            },
          },
        ],
      }),
    })

    const app = await fetchChatBridgeAppById('weather')

    expect(app).toEqual(
      expect.objectContaining({
        appId: 'weather',
        mockMode: 'weather',
      })
    )
  })

  it('loads class allowlist state from the backend', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        classId: 'demo-class',
        allowlist: [
          {
            classId: 'demo-class',
            appId: 'chess',
            enabledBy: 'teacher-demo',
            enabledAt: 123,
          },
        ],
      }),
    })

    const allowlist = await fetchChatBridgeAllowlist('demo-class')

    expect(allowlist).toEqual([
      expect.objectContaining({
        classId: 'demo-class',
        appId: 'chess',
      }),
    ])
  })

  it('registers a manifest and invalidates cached app queries', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        app: {
          reviewState: 'pending',
          manifest: {
            appId: 'story-builder',
            name: 'AI Story Builder',
            version: '1.0.0',
            description: 'Structured stories.',
            developerName: 'Backend',
            executionModel: 'iframe',
            launchUrl: 'https://apps.chatbridge.local/story-builder',
            allowedOrigins: ['https://apps.chatbridge.local'],
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
        },
      }),
    })

    const app = await registerChatBridgeApp({
      appId: 'story-builder',
      name: 'AI Story Builder',
      version: '1.0.0',
      description: 'Structured stories.',
      developerName: 'Backend',
      executionModel: 'iframe',
      launchUrl: 'https://apps.chatbridge.local/story-builder',
      allowedOrigins: ['https://apps.chatbridge.local'],
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
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/registry/apps',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(app).toEqual(
      expect.objectContaining({
        appId: 'story-builder',
        reviewState: 'pending',
      })
    )
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['chatbridge'] })
  })

  it('reviews apps and invalidates class-scoped queries when class allowlist changes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          app: {
            reviewState: 'approved',
            manifest: {
              appId: 'story-builder',
              name: 'AI Story Builder',
              version: '1.0.0',
              description: 'Structured stories.',
              developerName: 'Backend',
              executionModel: 'iframe',
              launchUrl: 'https://apps.chatbridge.local/story-builder',
              allowedOrigins: ['https://apps.chatbridge.local'],
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
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          classId: 'demo-class',
          allowlistEntry: {
            classId: 'demo-class',
            appId: 'story-builder',
            enabledBy: 'teacher-demo',
            enabledAt: 123,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          classId: 'demo-class',
          allowlistEntry: {
            classId: 'demo-class',
            appId: 'story-builder',
            enabledBy: 'teacher-demo',
            enabledAt: 123,
            disabledAt: 456,
          },
        }),
      })

    await reviewChatBridgeApp('story-builder', {
      reviewState: 'approved',
      reviewerId: 'admin-1',
    })

    await enableChatBridgeAppForClass('demo-class', 'story-builder', 'teacher-demo')
    await disableChatBridgeAppForClass('demo-class', 'story-builder', 'teacher-demo')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8787/api/registry/apps/story-builder/review',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8787/api/classes/demo-class/allowlist',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8787/api/classes/demo-class/allowlist/story-builder/disable',
      expect.objectContaining({ method: 'POST' })
    )
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['chatbridge'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['chatbridge', 'class-apps', 'demo-class'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['chatbridge', 'class-allowlist', 'demo-class'] })
  })
})
