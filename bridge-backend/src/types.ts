export type ReviewState = 'pending' | 'approved' | 'rejected' | 'suspended'
export type UserRole = 'admin' | 'teacher' | 'student' | 'developer'

export type RuntimeAuthType = 'none' | 'api-key' | 'oauth2'
export type OAuthProvider = 'google'

export type ToolManifest = {
  name: string
  description: string
}

export type AppManifest = {
  appId: string
  name: string
  version: string
  description: string
  developerName: string
  executionModel: 'iframe' | 'server-side'
  launchUrl?: string
  allowedOrigins: string[]
  heartbeatTimeoutMs?: number
  authType: RuntimeAuthType
  oauthProvider?: OAuthProvider
  oauthScopes?: string[]
  subjectTags: string[]
  gradeBand?: string
  llmSafeFields: string[]
  tools: ToolManifest[]
}

export type AppRegistryEntry = {
  manifest: AppManifest
  reviewState: ReviewState
  registeredAt: number
  reviewedAt?: number
  reviewNotes?: string
  ownerUserId?: string
  ownerEmail?: string
  activeManifest?: AppManifest
  activeVersion?: string
  pendingManifest?: AppManifest
  pendingVersion?: string
}

export type AppVersionRecord = {
  appId: string
  version: string
  manifest: AppManifest
  reviewState: ReviewState
  submittedAt: number
  reviewedAt?: number
  reviewNotes?: string
  ownerUserId?: string
  ownerEmail?: string
}

export type ClassAppAllowlist = {
  classId: string
  appId: string
  enabledBy: string
  enabledAt: number
  disabledAt?: number
}

export type ReviewAction = {
  appId: string
  version: string
  action: 'approve' | 'reject' | 'suspend' | 'reinstate' | 'request_changes'
  reviewerId: string
  notes?: string
  timestamp: number
}

export type AuditEvent = {
  timestamp: number
  traceId: string
  eventType: string
  source: 'frontend' | 'bridge-backend' | 'app'
  sessionId?: string
  classId?: string
  studentId?: string
  appId?: string
  appVersion?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export type BridgeAppRuntimeStatus = 'idle' | 'ready' | 'active' | 'error' | 'complete'

export type BridgeAppContext = {
  appId: string
  status: BridgeAppRuntimeStatus
  summary?: string
  lastEventAt?: number
  lastState?: Record<string, unknown>
  lastError?: string
}

export type SessionBridgeState = {
  activeAppId?: string
  activeClassId: string
  appContext: Record<string, BridgeAppContext>
}

export type BridgeSessionRecord = {
  sessionId: string
  userId: string
  bridgeState: SessionBridgeState
  updatedAt: number
}

export type OAuthTokenRecord = {
  userId: string
  appId: string
  provider: OAuthProvider
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes: string[]
  createdAt: number
  lastRefreshedAt?: number
}

export type UserProfile = {
  userId: string
  email?: string
  role: UserRole
  createdAt: number
  updatedAt: number
}

export type ChatSessionMetaRecord = {
  id: string
  userId: string
  name: string
  type?: 'chat' | 'picture'
  starred?: boolean
  hidden?: boolean
  assistantAvatarKey?: string
  picUrl?: string
  orderIndex: number
  createdAt: number
  updatedAt: number
}

export type ChatSessionRecord = ChatSessionMetaRecord & {
  session: Record<string, unknown>
}
