import { z } from 'zod'

export const AuditEventSchema = z.object({
  timestamp: z.number(),
  traceId: z.string().min(1),
  eventType: z.string().min(1),
  source: z.enum(['frontend', 'bridge-backend', 'app']),
  sessionId: z.string().optional(),
  classId: z.string().optional(),
  studentId: z.string().optional(),
  appId: z.string().optional(),
  appVersion: z.string().optional(),
  summary: z.string().max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ClassIdParamsSchema = z.object({
  classId: z.string().min(1),
})

export const AppManifestSchema = z.object({
  appId: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  description: z.string().min(1).max(1000),
  developerName: z.string().min(1).max(120),
  executionModel: z.enum(['iframe', 'server-side']),
  launchUrl: z.string().optional(),
  allowedOrigins: z.array(z.string().max(300)).min(1).max(10),
  heartbeatTimeoutMs: z.number().positive().optional(),
  authType: z.enum(['none', 'api-key', 'oauth2']),
  subjectTags: z.array(z.string().max(80)).max(20),
  gradeBand: z.string().max(40).optional(),
  llmSafeFields: z.array(z.string().max(100)).max(20),
  tools: z.array(
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().min(1).max(500),
    })
  ).max(20),
})

export const ReviewStateSchema = z.enum(['pending', 'approved', 'rejected', 'suspended'])

export const ReviewActionBodySchema = z.object({
  reviewState: ReviewStateSchema,
  version: z.string().min(1).max(40).optional(),
  reviewerId: z.string().min(1).max(100),
  reviewNotes: z.string().max(1000).optional(),
})

export const AppIdParamsSchema = z.object({
  appId: z.string().min(1),
})

export const ClassAllowlistBodySchema = z.object({
  appId: z.string().min(1).max(100),
  enabledBy: z.string().min(1).max(100),
})

export const ClassAllowlistToggleBodySchema = z.object({
  enabledBy: z.string().min(1).max(100),
})

export const BackendChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(8000),
})

export const BackendChatRequestSchema = z.object({
  sessionId: z.string().min(1).max(120).optional(),
  classId: z.string().min(1).max(120).optional(),
  messages: z.array(BackendChatMessageSchema).min(1).max(40),
})

export const BridgeAppRuntimeStatusSchema = z.enum(['idle', 'ready', 'active', 'error', 'complete'])

export const BridgeAppContextSchema = z.object({
  appId: z.string().min(1).max(100),
  status: BridgeAppRuntimeStatusSchema.default('idle'),
  summary: z.string().max(1000).optional(),
  lastEventAt: z.number().optional(),
  lastState: z.record(z.string(), z.unknown()).optional(),
  lastError: z.string().max(1000).optional(),
})

export const SessionBridgeStateSchema = z.object({
  activeAppId: z.string().max(100).optional(),
  activeClassId: z.string().max(120).default('demo-class'),
  appContext: z.record(z.string(), BridgeAppContextSchema).default({}),
})

export const SessionIdParamsSchema = z.object({
  sessionId: z.string().min(1).max(120),
})

export const BridgeSessionUpsertBodySchema = z.object({
  bridgeState: SessionBridgeStateSchema,
})
