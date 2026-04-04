import type { BridgeAppManifest } from '@shared/types'

export const DEFAULT_TEACHER_ID = 'teacher-demo'
export const DEFAULT_REVIEWER_ID = 'platform-admin'

export const DEMO_STORY_BUILDER_MANIFEST: BridgeAppManifest = {
  appId: 'story-builder',
  name: 'AI Story Builder',
  version: '1.0.0',
  description: 'Structured storytelling workspace that keeps TutorMeAI in charge of prompting and guardrails.',
  developerName: 'ChatBridge Demo',
  executionModel: 'iframe',
  launchUrl: 'https://apps.chatbridge.local/story-builder',
  allowedOrigins: ['https://apps.chatbridge.local'],
  authType: 'none',
  subjectTags: ['ELA', 'Creative Writing'],
  gradeBand: '3-8',
  llmSafeFields: ['storyTitle', 'chapterCount', 'draftStatus'],
  tools: [
    {
      name: 'chatbridge_story_builder_open',
      description: 'Open the structured AI story builder for the current student.',
    },
  ],
}
