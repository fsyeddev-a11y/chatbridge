import { describe, expect, it } from 'vitest'
import {
  getStandaloneModelManifest,
  getStandaloneRemoteConfigValue,
  shouldSkipChatboxCloudRequests,
  shouldSkipProviderSetup,
} from '@/packages/chatbox-cloud'

describe('chatbox cloud standalone fallbacks', () => {
  it('returns safe remote config defaults for standalone web deployments', () => {
    expect(getStandaloneRemoteConfigValue('setting_chatboxai_first')).toEqual({
      setting_chatboxai_first: false,
    })
    expect(getStandaloneRemoteConfigValue('product_ids')).toEqual({
      product_ids: [],
    })
  })

  it('returns an empty model manifest when chatbox cloud is disabled', () => {
    expect(getStandaloneModelManifest()).toEqual({
      groupName: 'Standalone',
      models: [],
    })
  })

  it('skips provider setup when standalone mode is enabled', () => {
    expect(shouldSkipProviderSetup(true)).toBe(true)
    expect(shouldSkipProviderSetup(false)).toBe(false)
  })

  it('skips optional Chatbox cloud requests in standalone mode', () => {
    expect(shouldSkipChatboxCloudRequests(true)).toBe(true)
    expect(shouldSkipChatboxCloudRequests(false)).toBe(false)
  })
})
