Here are my questions.

```json
{
  "questions": [
    { "question": "Which frontend framework?", "why": "Shapes the folder structure and routing.", "default": "Next.js 15 App Router" },
    { "question": "Where should data live?", "why": "Drives the schema and the client library.", "default": "Postgres on Supabase" },
    { "question": "How do users sign in?", "why": "Auth provider changes middleware and env vars.", "default": "Email magic link via Supabase Auth" },
    { "question": "Do todos need due dates?", "why": "Adds a column and UI.", "default": "No, title and done only" },
    { "question": "Should the list reorder by drag and drop?", "why": "Adds a position column and a library.", "default": "No, newest first" },
    { "question": "Is offline support needed?", "why": "Needs a local cache and sync.", "default": "No" },
    { "question": "Which styling approach?", "why": "Sets agents.md styling rules.", "default": "Tailwind CSS 4" },
    { "question": "Where will it be hosted?", "why": "Affects env vars and build output.", "default": "Vercel" },
    { "question": "Which test runner?", "why": "Must match the check commands.", "default": "Vitest" },
    { "question": "Do you want error tracking?", "why": "Optional Sentry env var.", "default": "Optional Sentry, off by default" }
  ]
}
```
