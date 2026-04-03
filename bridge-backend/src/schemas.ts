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
  summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const ClassIdParamsSchema = z.object({
  classId: z.string().min(1),
})

export const AppManifestSchema = z.object({
  appId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  developerName: z.string().min(1),
  executionModel: z.enum(['iframe', 'server-side']),
  launchUrl: z.string().optional(),
  allowedOrigins: z.array(z.string()).min(1),
  heartbeatTimeoutMs: z.number().positive().optional(),
  authType: z.enum(['none', 'api-key', 'oauth2']),
  subjectTags: z.array(z.string()),
  gradeBand: z.string().optional(),
  llmSafeFields: z.array(z.string()),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
    })
  ),
})

export const ReviewStateSchema = z.enum(['pending', 'approved', 'rejected', 'suspended'])

export const ReviewActionBodySchema = z.object({
  reviewState: ReviewStateSchema,
  reviewerId: z.string().min(1),
  reviewNotes: z.string().optional(),
})

export const AppIdParamsSchema = z.object({
  appId: z.string().min(1),
})

export const ClassAllowlistBodySchema = z.object({
  appId: z.string().min(1),
  enabledBy: z.string().min(1),
})

export const ClassAllowlistToggleBodySchema = z.object({
  enabledBy: z.string().min(1),
})
