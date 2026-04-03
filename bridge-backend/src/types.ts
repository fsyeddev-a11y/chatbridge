export type ReviewState = 'pending' | 'approved' | 'rejected' | 'suspended'

export type RuntimeAuthType = 'none' | 'api-key' | 'oauth2'

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
  authType: RuntimeAuthType
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
}

export type ClassAppAllowlist = {
  classId: string
  appId: string
  enabledBy: string
  enabledAt: number
  disabledAt?: number
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
