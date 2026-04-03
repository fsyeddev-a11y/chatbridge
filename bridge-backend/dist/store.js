export function createInMemoryBridgeStore() {
    const now = Date.now();
    const registryEntries = [
        {
            reviewState: 'approved',
            registeredAt: now,
            reviewedAt: now,
            manifest: {
                appId: 'chess',
                name: 'Chess Coach',
                version: '1.0.0',
                description: 'Interactive chess board with guided tutoring.',
                developerName: 'ChatBridge Demo',
                executionModel: 'iframe',
                allowedOrigins: ['https://apps.chatbridge.local'],
                authType: 'none',
                subjectTags: ['Strategy', 'Logic'],
                gradeBand: '3-12',
                llmSafeFields: ['phase', 'fen'],
                tools: [
                    {
                        name: 'chatbridge_chess_start_game',
                        description: 'Start a new chess game for the current student.',
                    },
                    {
                        name: 'chatbridge_chess_get_hint',
                        description: 'Get a tutoring hint for the current board position.',
                    },
                ],
            },
        },
        {
            reviewState: 'approved',
            registeredAt: now,
            reviewedAt: now,
            manifest: {
                appId: 'weather',
                name: 'Weather Dashboard',
                version: '1.0.0',
                description: 'Lightweight public weather app for quick lookups.',
                developerName: 'ChatBridge Demo',
                executionModel: 'iframe',
                allowedOrigins: ['https://apps.chatbridge.local'],
                authType: 'none',
                subjectTags: ['Science'],
                gradeBand: 'K-12',
                llmSafeFields: ['location', 'conditions', 'temperatureF'],
                tools: [
                    {
                        name: 'chatbridge_weather_lookup',
                        description: 'Look up current weather for a student-selected location.',
                    },
                ],
            },
        },
        {
            reviewState: 'approved',
            registeredAt: now,
            reviewedAt: now,
            manifest: {
                appId: 'google-classroom',
                name: 'Google Classroom Assistant',
                version: '1.0.0',
                description: 'Read-only classroom context for due dates and coursework.',
                developerName: 'ChatBridge Demo',
                executionModel: 'iframe',
                allowedOrigins: ['https://apps.chatbridge.local'],
                authType: 'oauth2',
                subjectTags: ['Productivity', 'Classroom'],
                gradeBand: '3-12',
                llmSafeFields: ['courseCount', 'upcomingAssignments'],
                tools: [
                    {
                        name: 'chatbridge_google_classroom_overview',
                        description: 'Retrieve a read-only summary of the student classroom workload.',
                    },
                ],
            },
        },
    ];
    const classAllowlist = [
        { classId: 'demo-class', appId: 'chess', enabledBy: 'teacher-demo', enabledAt: now },
        { classId: 'demo-class', appId: 'weather', enabledBy: 'teacher-demo', enabledAt: now },
        { classId: 'demo-class', appId: 'google-classroom', enabledBy: 'teacher-demo', enabledAt: now },
    ];
    const auditEvents = [];
    return {
        listRegistryEntries() {
            return registryEntries;
        },
        getRegistryEntry(appId) {
            return registryEntries.find((entry) => entry.manifest.appId === appId);
        },
        listApprovedAppsForClass(classId) {
            const enabledAppIds = new Set(classAllowlist.filter((entry) => entry.classId === classId && !entry.disabledAt).map((entry) => entry.appId));
            return registryEntries.filter((entry) => entry.reviewState === 'approved' && enabledAppIds.has(entry.manifest.appId));
        },
        listClassAllowlist(classId) {
            return classAllowlist.filter((entry) => entry.classId === classId);
        },
        appendAuditEvent(event) {
            auditEvents.push(event);
            return event;
        },
        listAuditEvents() {
            return auditEvents;
        },
    };
}
