import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
describe('bridge-backend app', () => {
    it('returns health status', async () => {
        const app = createApp();
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            status: 'ok',
            service: 'bridge-backend',
        });
    });
    it('returns approved apps for a class from backend-owned allowlist state', async () => {
        const app = createApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/classes/demo-class/apps',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(expect.objectContaining({
            classId: 'demo-class',
            apps: expect.arrayContaining([
                expect.objectContaining({
                    manifest: expect.objectContaining({ appId: 'chess' }),
                }),
                expect.objectContaining({
                    manifest: expect.objectContaining({ appId: 'weather' }),
                }),
                expect.objectContaining({
                    manifest: expect.objectContaining({ appId: 'google-classroom' }),
                }),
            ]),
        }));
    });
    it('accepts structured audit events', async () => {
        const app = createApp();
        const response = await app.inject({
            method: 'POST',
            url: '/api/audit/events',
            payload: {
                timestamp: Date.now(),
                traceId: 'trace-1',
                eventType: 'GenerationStarted',
                source: 'frontend',
                sessionId: 'session-1',
            },
        });
        expect(response.statusCode).toBe(202);
        expect(response.json()).toEqual(expect.objectContaining({
            accepted: true,
            event: expect.objectContaining({
                traceId: 'trace-1',
                eventType: 'GenerationStarted',
                source: 'frontend',
            }),
        }));
    });
    it('rejects invalid audit events', async () => {
        const app = createApp();
        const response = await app.inject({
            method: 'POST',
            url: '/api/audit/events',
            payload: {
                source: 'frontend',
            },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual(expect.objectContaining({
            error: 'validation_error',
        }));
    });
});
