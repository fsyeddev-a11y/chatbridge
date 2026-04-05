import type { BridgeAppManifest } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseAuthHeaders, useSupabaseAuthState } from '@/packages/supabase'
import queryClient from '@/stores/queryClient'

export type ChatBridgeAppDefinition = BridgeAppManifest & {
  reviewState: 'approved' | 'pending' | 'rejected' | 'suspended'
  enabledClassIds: string[]
  llmOwnership: 'platform'
  ownerUserId?: string
  ownerEmail?: string
  reviewNotes?: string
  reviewedAt?: number
  registeredAt?: number
  activeVersion?: string
  pendingVersion?: string
}

export type ChatBridgeAllowlistEntry = {
  classId: string
  appId: string
  enabledBy: string
  enabledAt: number
  disabledAt?: number
}

export type ChatBridgeReviewAction = {
  appId: string
  version: string
  action: 'approve' | 'reject' | 'suspend' | 'request_changes'
  reviewerId: string
  notes?: string
  timestamp: number
}

type RegistryApiResponse = {
  apps: Array<{
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
    ownerUserId?: string
    ownerEmail?: string
    reviewNotes?: string
    reviewedAt?: number
    registeredAt?: number
    activeVersion?: string
    pendingVersion?: string
  }>
}

type ClassAppsApiResponse = {
  classId: string
  apps: Array<{
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
  }>
}

type ClassAllowlistApiResponse = {
  classId: string
  allowlist: ChatBridgeAllowlistEntry[]
}

type RegistryAppResponse = {
  app: {
    manifest: BridgeAppManifest
    reviewState: ChatBridgeAppDefinition['reviewState']
    ownerUserId?: string
    ownerEmail?: string
    reviewNotes?: string
    reviewedAt?: number
    registeredAt?: number
    activeVersion?: string
    pendingVersion?: string
  }
}

type ReviewActionsApiResponse = {
  actions: ChatBridgeReviewAction[]
}

const CHATBRIDGE_API_ORIGIN = process.env.CHATBRIDGE_API_ORIGIN || 'http://localhost:8787'
const CHATBRIDGE_WEATHER_APP_URL = process.env.CHATBRIDGE_WEATHER_APP_URL || 'http://localhost:4173'
const CHATBRIDGE_WEATHER_APP_ORIGIN = (() => {
  try {
    return new URL(CHATBRIDGE_WEATHER_APP_URL).origin
  } catch {
    return 'http://localhost:4173'
  }
})()

export const ChatBridgeQueryKeys = {
  ChatBridgeApps: ['chatbridge', 'apps'],
  ChatBridgeDeveloperApps: ['chatbridge', 'developer-apps'],
  ChatBridgeDeveloperReviewActions: ['chatbridge', 'developer-review-actions'],
  ChatBridgeClassApps: (classId: string) => ['chatbridge', 'class-apps', classId],
  ChatBridgeClassAllowlist: (classId: string) => ['chatbridge', 'class-allowlist', classId],
  ChatBridgeReviewActions: ['chatbridge', 'review-actions'],
}

function augmentAppDefinition(
  app: Omit<ChatBridgeAppDefinition, 'enabledClassIds' | 'llmOwnership'> &
    Partial<Pick<ChatBridgeAppDefinition, 'enabledClassIds' | 'llmOwnership'>>
): ChatBridgeAppDefinition {
  return {
    ...app,
    enabledClassIds: app.enabledClassIds || [],
    llmOwnership: app.llmOwnership || 'platform',
  }
}

function normalizeRegistryEntries(entries: RegistryApiResponse['apps']): ChatBridgeAppDefinition[] {
  return entries.map((entry) =>
    augmentAppDefinition({
      ...entry.manifest,
      reviewState: entry.reviewState,
      ownerUserId: entry.ownerUserId,
      ownerEmail: entry.ownerEmail,
      reviewNotes: entry.reviewNotes,
      reviewedAt: entry.reviewedAt,
      registeredAt: entry.registeredAt,
      activeVersion: entry.activeVersion,
      pendingVersion: entry.pendingVersion,
    })
  )
}

async function fetchJson<T>(path: string): Promise<T> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}${path}`, {
    headers: {
      ...authHeaders,
    },
  })

  if (!response.ok) {
    throw new Error(`ChatBridge backend request failed: ${response.status}`)
  }
  return (await response.json()) as T
}

async function sendJson<T>(path: string, method: 'POST', body: Record<string, unknown>): Promise<T> {
  const authHeaders = await getSupabaseAuthHeaders()
  const response = await fetch(`${CHATBRIDGE_API_ORIGIN}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`ChatBridge backend request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

async function invalidateChatBridgeQueries(classId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['chatbridge'] }),
    queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperApps }),
    queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperReviewActions }),
    classId ? queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeClassApps(classId) }) : Promise.resolve(),
    classId
      ? queryClient.invalidateQueries({ queryKey: ChatBridgeQueryKeys.ChatBridgeClassAllowlist(classId) })
      : Promise.resolve(),
  ])
}

export async function fetchChatBridgeApps(): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<RegistryApiResponse>('/api/registry/apps')
  return normalizeRegistryEntries(response.apps)
}

export async function fetchApprovedChatBridgeAppsForClass(classId: string): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<ClassAppsApiResponse>(`/api/classes/${classId}/apps`)
  return normalizeRegistryEntries(response.apps)
}

export async function fetchChatBridgeAppById(appId: string | undefined): Promise<ChatBridgeAppDefinition | undefined> {
  if (!appId) {
    return undefined
  }

  try {
    const allApps = await queryClient.ensureQueryData({
      queryKey: ChatBridgeQueryKeys.ChatBridgeApps,
      queryFn: fetchChatBridgeApps,
      staleTime: 30_000,
    })
    return allApps.find((app) => app.appId === appId)
  } catch {
    return undefined
  }
}

export function useChatBridgeApps() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeApps,
    queryFn: fetchChatBridgeApps,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function fetchDeveloperChatBridgeApps(): Promise<ChatBridgeAppDefinition[]> {
  const response = await fetchJson<RegistryApiResponse>('/api/developer/apps')
  return normalizeRegistryEntries(response.apps)
}

export function useDeveloperChatBridgeApps() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperApps,
    queryFn: fetchDeveloperChatBridgeApps,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function fetchDeveloperChatBridgeReviewActions(): Promise<ChatBridgeReviewAction[]> {
  const response = await fetchJson<ReviewActionsApiResponse>('/api/developer/review-actions')
  return response.actions
}

export function useDeveloperChatBridgeReviewActions() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeDeveloperReviewActions,
    queryFn: fetchDeveloperChatBridgeReviewActions,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export function useApprovedChatBridgeAppsForClass(classId: string) {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeClassApps(classId),
    queryFn: () => fetchApprovedChatBridgeAppsForClass(classId),
    staleTime: 30_000,
    enabled: !!classId && !loading && isAuthenticated,
  })
}

export async function fetchChatBridgeAllowlist(classId: string): Promise<ChatBridgeAllowlistEntry[]> {
  const response = await fetchJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist`)
  return response.allowlist
}

export function useChatBridgeAllowlist(classId: string) {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeClassAllowlist(classId),
    queryFn: () => fetchChatBridgeAllowlist(classId),
    staleTime: 30_000,
    enabled: !!classId && !loading && isAuthenticated,
  })
}

export async function fetchChatBridgeReviewActions(): Promise<ChatBridgeReviewAction[]> {
  const response = await fetchJson<ReviewActionsApiResponse>('/api/review-actions')
  return response.actions
}

export function useChatBridgeReviewActions() {
  const { loading, isAuthenticated } = useSupabaseAuthState()

  return useQuery({
    queryKey: ChatBridgeQueryKeys.ChatBridgeReviewActions,
    queryFn: fetchChatBridgeReviewActions,
    staleTime: 30_000,
    enabled: !loading && isAuthenticated,
  })
}

export async function registerChatBridgeApp(manifest: BridgeAppManifest) {
  const response = await sendJson<RegistryAppResponse>('/api/registry/apps', 'POST', manifest)
  await invalidateChatBridgeQueries()
  return augmentAppDefinition({
    ...response.app.manifest,
    reviewState: response.app.reviewState,
    ownerUserId: response.app.ownerUserId,
    ownerEmail: response.app.ownerEmail,
    reviewNotes: response.app.reviewNotes,
    reviewedAt: response.app.reviewedAt,
    registeredAt: response.app.registeredAt,
    activeVersion: response.app.activeVersion,
    pendingVersion: response.app.pendingVersion,
  })
}

export async function reviewChatBridgeApp(
  appId: string,
  input: {
    reviewState: ChatBridgeAppDefinition['reviewState']
    reviewerId: string
    reviewNotes?: string
    version?: string
  }
) {
  const response = await sendJson<RegistryAppResponse>(`/api/registry/apps/${appId}/review`, 'POST', input)
  await invalidateChatBridgeQueries()
  return augmentAppDefinition({
    ...response.app.manifest,
    reviewState: response.app.reviewState,
    ownerUserId: response.app.ownerUserId,
    ownerEmail: response.app.ownerEmail,
    reviewNotes: response.app.reviewNotes,
    reviewedAt: response.app.reviewedAt,
    registeredAt: response.app.registeredAt,
    activeVersion: response.app.activeVersion,
    pendingVersion: response.app.pendingVersion,
  })
}

export async function enableChatBridgeAppForClass(classId: string, appId: string, enabledBy: string) {
  await sendJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist`, 'POST', {
    appId,
    enabledBy,
  })
  await invalidateChatBridgeQueries(classId)
}

export async function disableChatBridgeAppForClass(classId: string, appId: string, enabledBy: string) {
  await sendJson<ClassAllowlistApiResponse>(`/api/classes/${classId}/allowlist/${appId}/disable`, 'POST', {
    enabledBy,
  })
  await invalidateChatBridgeQueries(classId)
}
