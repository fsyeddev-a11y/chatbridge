import { z } from 'zod';
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
});
export const ClassIdParamsSchema = z.object({
    classId: z.string().min(1),
});
