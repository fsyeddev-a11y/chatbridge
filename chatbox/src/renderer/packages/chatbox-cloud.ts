import type { RemoteConfig } from '@shared/types'

export type StandaloneRemoteConfigKey = keyof RemoteConfig

const STANDALONE_REMOTE_CONFIG: RemoteConfig = {
  setting_chatboxai_first: false,
  current_version: '',
  product_ids: [],
  knowledge_base_models: undefined,
}

export function getStandaloneRemoteConfigValue<K extends StandaloneRemoteConfigKey>(config: K): Pick<RemoteConfig, K> {
  return {
    [config]: STANDALONE_REMOTE_CONFIG[config],
  } as Pick<RemoteConfig, K>
}

export function getStandaloneModelManifest() {
  return {
    groupName: 'Standalone',
    models: [],
  }
}

export function shouldSkipProviderSetup(disableChatboxCloud: boolean) {
  return disableChatboxCloud
}

export function shouldSkipChatboxCloudRequests(disableChatboxCloud: boolean) {
  return disableChatboxCloud
}
