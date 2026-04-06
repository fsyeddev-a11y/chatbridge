# Chess App

This folder is planning-only. It defines the product, integration contract, and implementation plan for a new external `chess-app` that will later be registered with ChatBridge as a third-party iframe app.

Scope:
- standalone hosted chess app
- integrates with TutorMeAI through the existing ChatBridge iframe protocol
- no edits to `bridge-backend`, `chatbox`, or `weather-app`

Documents:
- `IMPLEMENTATION_PLAN.md`: phased build plan and acceptance criteria
- `SPEC.md`: product, UX, state model, and ChatBridge integration contract
- `MANIFEST_AND_TESTING.md`: proposed manifest shape, event examples, and test matrix

Non-goals for this folder:
- no production code yet
- no backend registration changes
- no frontend host changes

