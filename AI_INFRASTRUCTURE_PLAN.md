# AI Infrastructure Plan — מקרבים CRM
> Planning document only. No code changes. No package installs.
> Last updated: 2026-05-03

---

## Table of Contents
1. [Current Foundations](#1-current-foundations)
2. [Feature א — Reminder Infrastructure](#2-feature-א--reminder-infrastructure)
3. [Exact Reminder Timing Rules](#3-exact-reminder-timing-rules)
4. [Future Mobile Push Notification Preparation](#4-future-mobile-push-notification-preparation)
5. [Feature ב — Speech-to-Text + AI Summary Infrastructure](#5-feature-ב--speech-to-text--ai-summary-infrastructure)
6. [Future Files and Modules Needed](#6-future-files-and-modules-needed)
7. [What NOT to Install Yet](#7-what-not-to-install-yet)
8. [Safe Phased Implementation Roadmap](#8-safe-phased-implementation-roadmap)

---

## 1. Current Foundations

### What already exists and must not be broken

#### Reminder System
| File | What it provides |
|---|---|
| `lib/reminderSchedulerDemo.js` | Complete 4-stage state machine: `NONE → NIGHT_23 → MORNING_10 → LAST_1130 → MANAGER_1200`. Functions: `advanceBaseReportReminder`, `advanceReminderStageForReports`, `getReminderStatus`, `createManagerEscalation`, `createActivistReminder` |
| `lib/notificationDemo.js` | In-app notification store backed by localStorage. Functions: `createDemoNotification`, `getNotificationsForUser`, `createBaseMeetingSubmittedNotifications`, `generateReminderNotifications`. Supports user-scoped and role-broadcast notifications. |
| `lib/CrmStore.jsx` | Exposes `advanceBaseMeetingReminders(predicate)` on context. Persists report state (including `reminderStage`) to localStorage key `crm_base_meeting_reports_demo_v1`. |
| `pages/meeting-houses/[id].jsx` | Has a manual "run reminders demo" button that calls `advanceReminderStageForReports` for a specific house — the only current trigger. |
| `pages/base-meetings.jsx` | Reads `getReminderStatus(meeting)` to show per-card status badge. |

#### AI Summary System
| File | What it provides |
|---|---|
| `lib/aiDemo.js` | Four demo summarizers using Hebrew keyword matching: `summarizeBaseMeetingDemo`, `summarizeInteractionDemo`, `generateMeetingNotesAiSummaryDemo`, `summarizeMeetingHouseSeriesDemo` |
| `pages/base-meetings.jsx` | "סיכום AI דמו חכם" button on submitted reports. Converts structured form (`structured_answers`) to text via `structuredToText()` and passes to `summarizeBaseMeetingDemo`. |
| `lib/baseMeetingUtils.js` | `ai_summary: null` field already declared on every generated base-meeting record. |
| `data/base-meetings.js` | 13-field structured report schema fully defined: `arrival_time`, `participant_count`, `gender_distribution`, `religious_distribution`, `age_distribution`, `diversity_level`, `facilitation_quality`, `facilitation_notes`, `atmosphere`, `group_progress`, `personal_connections_status`, `personal_connections_notes`, `general_notes` |

#### What the foundations give us
- The stage machine logic is **production-ready** — no rewrite needed.
- The notification fan-out to managers is already coded.
- The structured form text serializer (`structuredToText`) produces clean input for a real AI prompt.
- The `ai_summary` field slot exists, waiting to be populated.

---

## 2. Feature א — Reminder Infrastructure

### Problem Statement
The stage machine exists but is **never triggered automatically**. It requires a manager to manually click a button. Production requires the system to fire reminders based on wall-clock time relative to each meeting's date.

### Design Principles
1. **Additive only** — new triggering code sits on top of the existing machine. `reminderSchedulerDemo.js` is not modified.
2. **Idempotent** — running the trigger twice must not send the same notification twice. A run-once guard prevents duplicate fires.
3. **Client-side only for now** — the system has no backend. The trigger runs in the browser on page load, using `localStorage` as the state store.
4. **Graceful degradation** — if the user doesn't open the app on a reminder day, the next app open catches up to the correct stage without skipping escalation logic.
5. **Delivery is decoupled from stage logic** — a separate delivery stub is introduced so real Push/SMS can be wired later without touching the state machine.

### Architecture

```
pages/_app.jsx  (mount once on client)
     │
     └─ useEffect (once, client-side) ─────► lib/reminderTrigger.js  [NEW]
                                                       │
                                          ┌────────────▼────────────────┐
                                          │  1. Load unsubmitted reports │
                                          │  2. For each report:         │
                                          │     compute expectedStage    │
                                          │     from meeting.date + now  │
                                          │  3. If currentStage <        │
                                          │     expectedStage: advance   │
                                          │     (only the delta)         │
                                          │  4. Run-once guard:          │
                                          │     localStorage timestamp   │
                                          │     skip if < 60 min ago     │
                                          └────────────┬────────────────┘
                                                       │
                                          ┌────────────▼────────────────┐
                                          │  lib/reminderSchedulerDemo.js│
                                          │  advanceBaseReportReminder() │
                                          │  (existing — unchanged)      │
                                          └────────────┬────────────────┘
                                                       │
                                          ┌────────────▼────────────────┐
                                          │  lib/reminderDelivery.js     │
                                          │  [NEW]  sendReminder(n)      │
                                          │  → no-op stub now            │
                                          │  → future: Push/SMS/WA       │
                                          └─────────────────────────────┘
```

### Key Design Decisions

**Run-once guard**: Store `reminders_last_check_at` (ISO timestamp) in localStorage. On page load, skip the trigger if last check was less than 60 minutes ago. This prevents excessive firing when users navigate between pages.

**Catch-up logic**: If a user opens the app on day+2, the trigger computes `expectedStage = 4` (escalation already passed) and advances the report directly to stage 4, firing the escalation notification. The system does not silently skip stages.

**`reminderStage` field initialization**: Currently `data/base-meetings.js` seed records and `baseMeetingUtils.js` generated records do not include `reminderStage`. The trigger must treat a missing or undefined `reminderStage` as `0`. No schema migration needed — just defensive reads.

**Manager escalation fan-out**: Already coded in `createManagerEscalation()` in `reminderSchedulerDemo.js`. The trigger simply needs to call it via the existing `advanceBaseReportReminder` path.

---

## 3. Exact Reminder Timing Rules

All times are relative to the **meeting date** (`report.date`) and treat it as the meeting day.

| Stage | Constant | Trigger condition | Recipient | Notification type |
|---|---|---|---|---|
| 1 | `NIGHT_23` | `meetingDate` at `23:00` — same day as meeting | Activist | `base_report_reminder` (priority: `normal`) |
| 2 | `MORNING_10` | `meetingDate + 1 day` at `10:00` | Activist | `base_report_reminder` (priority: `normal`) |
| 3 | `LAST_1130` | `meetingDate + 1 day` at `11:30` | Activist | `base_report_reminder` (priority: `high`) — "last warning" |
| 4 | `MANAGER_1200` | `meetingDate + 1 day` at `12:00` | All project managers + CEO | `missing_report` (priority: `high`) — escalation |

### Time Computation Logic (for `reminderTrigger.js`)

```
function expectedStage(report, now):
  if report.submitted → return DONE (skip)
  
  meetingDate = parse(report.date)            // e.g. 2026-05-10
  t_23  = meetingDate at 23:00 local time     // same day
  t_10  = meetingDate+1 at 10:00 local time
  t_1130= meetingDate+1 at 11:30 local time
  t_12  = meetingDate+1 at 12:00 local time

  if now >= t_12   → expected = MANAGER_1200 (4)
  elif now >= t_1130 → expected = LAST_1130 (3)
  elif now >= t_10 → expected = MORNING_10 (2)
  elif now >= t_23 → expected = NIGHT_23 (1)
  else             → expected = NONE (0)

  return expected
```

### Rules
- Each stage fires **exactly once per report** (idempotent: `currentStage < expectedStage` check).
- If `report.date` is empty or unparseable, skip silently — do not advance.
- If a report is submitted mid-sequence, cancel remaining stages immediately (already handled by `report.submitted` guard in `advanceBaseReportReminder`).
- Stage 4 (manager escalation) fans out to **all** users returned by `getAchdutNotificationManagers()` — already implemented in `reminderSchedulerDemo.js`.
- Reminders do **not** repeat. Once stage 3 is reached, stage 3 notification is sent once and never again, even if the user keeps opening the app.

---

## 4. Future Mobile Push Notification Preparation

### Current State
All notifications are in-app only: stored in `localStorage`, shown only when the user has the CRM open in a browser. Nothing is sent when the app is closed.

### Preparation Strategy
Design the delivery layer now so that swapping from in-app to real Push requires changing **one file only** — `lib/reminderDelivery.js`.

### `lib/reminderDelivery.js` — Interface Contract (stub to build now)

```
sendReminder(notification, deliveryOptions)
  → notification: the normalized notification object from notificationDemo.js
  → deliveryOptions: { channel: 'inapp' | 'push' | 'sms' | 'whatsapp' }
  → returns: Promise<void>
```

When `channel = 'inapp'` (current): calls `createDemoNotification()` — existing behavior.
When `channel = 'push'` (future): calls Web Push API endpoint.
When `channel = 'sms'` (future): calls SMS gateway (Twilio / local Israeli provider).
When `channel = 'whatsapp'` (future): calls WhatsApp Business API.

### Web Push Preparation Checklist (future, do not implement yet)
- [ ] Create `public/sw.js` — service worker for push subscription management
- [ ] Create `pages/api/push/subscribe.js` — saves push subscriptions server-side
- [ ] Create `pages/api/push/send.js` — triggers Web Push via `web-push` npm package
- [ ] Add `next.config.js` service worker config (using `next-pwa` or manual SW registration)
- [ ] VAPID key generation and storage in environment variables

### Phone Number Field Preparation
For SMS/WhatsApp: the `users` table in `data/users.js` currently does not have a `phone` field. When the time comes, add `phone: null` to the user schema — but **not yet**.

### Architecture Note
The `reminderDelivery.js` stub must be introduced **before** integrating any real push library. This ensures the call site in `reminderTrigger.js` never needs to change when the delivery backend is upgraded.

---

## 5. Feature ב — Speech-to-Text + AI Summary Infrastructure

### Problem Statement
`lib/aiDemo.js` is keyword-only and explicitly states it will be replaced. The `ai_summary` field exists on every report but is always `null`. There is no audio capture, no real AI API call, and no server-side route to proxy API keys.

### Design Principles
1. **The demo layer is the fallback** — `aiDemo.js` stays intact and is used when the real AI is unavailable or not yet configured.
2. **API keys never touch the client** — all Anthropic / Whisper calls go through `pages/api/` routes (Next.js API routes run server-side).
3. **Progressive enhancement** — the form works without voice input. Voice is additive.
4. **Hebrew-first prompting** — the prompt template must explicitly instruct the model to respond in Hebrew and understand the organizational context.

### Architecture

```
pages/base-meetings.jsx
         │
         ├── existing structured form (13 fields) ──┐
         │                                           │
         └── components/VoiceInput.jsx  [NEW]        │
               │ onTranscript(text)                  │
               │ appended to general_notes           │
               │ or new voice_notes field            │
               └──────────────────────────────────► structuredToText()
                                                            │
                                               lib/aiService.js  [NEW]
                                               ┌─────────────────────┐
                                               │ if AI_ENABLED env:   │
                                               │   POST /api/ai-summary│
                                               │ else:                │
                                               │   aiDemo.js fallback │
                                               └──────────┬──────────┘
                                                          │
                                              pages/api/ai-summary.js  [NEW]
                                              ┌──────────────────────────┐
                                              │ Server-side only          │
                                              │ Reads ANTHROPIC_API_KEY   │
                                              │ from process.env          │
                                              │ Calls Claude API          │
                                              │ Returns { summary: string}│
                                              └──────────────────────────┘
```

### Speech-to-Text Strategy

**Phase 1 — Web Speech API (no cost, no server)**
- Built into Chrome and Edge (desktop + Android).
- Supports Hebrew (`lang="he-IL"`).
- Enough for internal pilot.
- Component: `components/VoiceInput.jsx`

**Phase 2 — Whisper API (production quality)**
- Required if: user is on Safari, iOS, or needs offline-capable Hebrew accuracy.
- Route: `pages/api/transcribe.js` — accepts audio blob, calls OpenAI Whisper or self-hosted Whisper.
- Hebrew Whisper accuracy is excellent for conversational speech.

### AI Summary Strategy

**Phase 1 — Claude via Anthropic API**
- Use `claude-sonnet-4-6` (current model, fast, cost-effective for summaries).
- Prompt template lives in `lib/prompts/baseMeetingPrompt.js` — a pure function, no API calls.
- The prompt instructs Claude to respond in Hebrew, act as an organizational coordinator, and analyze the 13 structured fields.
- API call lives in `pages/api/ai-summary.js` — server-side only.

**Phase 2 — Prompt caching**
- The organizational context (role definitions, mitzvot scale, project goals) is static across all summary calls.
- Add `cache_control: { type: "ephemeral" }` to the system prompt block once the API integration is working.
- This reduces cost by ~90% on repeated summarization calls.

### Prompt Template Design (for `lib/prompts/baseMeetingPrompt.js`)

The prompt should follow this structure:
```
[SYSTEM — cacheable]
  You are a coordinator assistant for the "Achdut Yehudit" organization.
  Your role: analyze field reports from base meeting activists.
  Always respond in Hebrew. Be concise, practical, and flag risks.
  [Organization context: mitzvot scale 0-4, relationship stages, etc.]

[USER — per request]
  Meeting report:
  House #X, City Y, Meeting N of 4, Date: D
  Activist: [name]
  
  [structured_answers fields rendered as labeled text]
  [voice_notes if present]
  
  Provide: relationship status, spiritual progress, coordinator flags, recommended next action.
```

---

## 6. Future Files and Modules Needed

### New files to create (in order of dependency)

| File | Purpose | Depends on |
|---|---|---|
| `lib/reminderTrigger.js` | Time-gating logic + run-once guard | `reminderSchedulerDemo.js`, `CrmStore` |
| `lib/reminderDelivery.js` | Delivery stub (in-app now, Push/SMS later) | `notificationDemo.js` |
| `lib/prompts/baseMeetingPrompt.js` | Hebrew prompt template builder function | Nothing (pure function) |
| `lib/aiService.js` | Toggle between demo and real API | `aiDemo.js`, fetch |
| `components/VoiceInput.jsx` | Mic button, Web Speech API, transcript display | React, Web Speech API |
| `pages/api/ai-summary.js` | Anthropic API proxy (server-side) | `ANTHROPIC_API_KEY` env var |
| `pages/api/transcribe.js` | Whisper API proxy (Phase 2 only) | `OPENAI_API_KEY` or Whisper endpoint |

### Existing files to modify (when implementing)

| File | What changes | Risk level |
|---|---|---|
| `pages/_app.jsx` | Add one `useEffect` to mount reminder trigger on client | Low |
| `lib/CrmStore.jsx` | No changes needed — `advanceBaseMeetingReminders` is already exposed | None |
| `lib/baseMeetingUtils.js` | Add `reminderStage: 0`, `voice_notes: null`, `transcript: null` to generated record template | Low |
| `data/base-meetings.js` | Add `reminderStage: 0` to all 4 seed records for consistency | Low |
| `pages/base-meetings.jsx` | Add `VoiceInput` component to form, wire `aiService` instead of `aiDemo` direct call | Medium |
| `lib/aiDemo.js` | Keep as-is. `aiService.js` wraps it — no changes to `aiDemo.js` itself | None |

### Environment variables needed (not yet)

| Variable | Used by | When |
|---|---|---|
| `ANTHROPIC_API_KEY` | `pages/api/ai-summary.js` | Phase 2 AI |
| `OPENAI_API_KEY` | `pages/api/transcribe.js` | Phase 2 STT (Whisper) |
| `NEXT_PUBLIC_AI_ENABLED` | `lib/aiService.js` | Feature flag — enables real AI vs demo |
| `NEXT_PUBLIC_STT_ENABLED` | `components/VoiceInput.jsx` | Feature flag — shows mic button |

---

## 7. What NOT to Install Yet

The following packages are needed in the future but **must not be installed until the corresponding phase begins**. Installing them now adds bloat, security surface, and potential build breakage with no benefit.

| Package | Why it's tempting | Why not yet |
|---|---|---|
| `@anthropic-ai/sdk` | Cleaner API client | Not needed until `pages/api/ai-summary.js` is created. Fetch works fine for a single endpoint call. |
| `web-push` | Required for server-side Web Push | Not needed until `pages/api/push/send.js` is created. |
| `next-pwa` or `workbox` | Service worker setup for push | Not needed until push subscription flow is designed end-to-end. |
| `openai` (for Whisper) | STT via Whisper API | Not needed until Phase 2 STT. Web Speech API covers Phase 1 with zero dependencies. |
| `react-media-recorder` | Easier audio capture | Web Speech API does not need this. Only needed if switching to Whisper blob upload. |
| `zod` or `yup` | API route input validation | Premature — the single AI route can validate with plain JS checks for now. |
| `socket.io` or any real-time lib | Real-time push | No real-time requirements defined yet. In-app polling is sufficient for v1. |

---

## 8. Safe Phased Implementation Roadmap

### Phase 0 — Preparation (no code changes, no packages)
- [ ] Define which deployment environment will hold API keys (Vercel env vars, self-hosted `.env`, etc.)
- [ ] Confirm mobile device targets for push notifications (iOS Safari requires PWA + specific entitlements)
- [ ] Agree on Hebrew prompt quality standard — collect 3-5 real submitted reports to test against before going live
- [ ] Decide: Web Speech API only (Phase 1 STT) OR jump directly to Whisper (depends on iOS Safari requirement)
- **Exit criteria**: decisions documented, no code written

---

### Phase 1 — Automatic Reminder Trigger (reminders only, no AI, no packages)
**Goal**: Reminders fire automatically based on wall-clock time. The demo button stays but is no longer the only trigger.

**Steps** (in order):
1. Add `reminderStage: 0` to `data/base-meetings.js` seed records
2. Add `reminderStage: 0` to `baseMeetingUtils.js` generated template
3. Create `lib/reminderDelivery.js` — stub only, wraps `createDemoNotification`
4. Create `lib/reminderTrigger.js` — time-gating logic, run-once guard, calls `advanceBaseReportReminder` via CrmStore
5. Wire `reminderTrigger.js` into `pages/_app.jsx` via one `useEffect`
6. Test manually: set a meeting date to yesterday, open app, verify stage advances to 4 and managers get notification

**Risk**: Low. No UI changes. No packages. Pure logic addition.
**Rollback**: Remove the `useEffect` line from `_app.jsx`.

---

### Phase 2 — Voice Input via Web Speech API (no packages, no server)
**Goal**: Activist can dictate notes into `general_notes` field using the browser mic. Transcript appears in the text area.

**Steps** (in order):
1. Create `components/VoiceInput.jsx` — mic toggle button, `window.SpeechRecognition` with `lang="he-IL"`, `onTranscript(text)` callback
2. Add the component to `pages/base-meetings.jsx` form — wired to the `general_notes` field only
3. Add `NEXT_PUBLIC_STT_ENABLED=false` to environment (mic button hidden until flag is `true`)
4. Test on Chrome desktop and Android Chrome

**Risk**: Low-medium. Component is isolated and opt-in via feature flag.
**Rollback**: Set `NEXT_PUBLIC_STT_ENABLED=false`.

---

### Phase 3 — Real AI Summary via Claude API (server-side)
**Goal**: Replace keyword demo with real Claude summarization on submitted reports.

**Steps** (in order):
1. Create `lib/prompts/baseMeetingPrompt.js` — pure function, no API calls, testable in isolation
2. Test prompt manually: paste output into Claude.ai, verify Hebrew quality meets standard
3. Create `pages/api/ai-summary.js` — minimal server route, `fetch` to Anthropic API, reads `ANTHROPIC_API_KEY` from `process.env`
4. Create `lib/aiService.js` — checks `NEXT_PUBLIC_AI_ENABLED`; if true calls `/api/ai-summary`, else falls back to `aiDemo.js`
5. Update `pages/base-meetings.jsx` — swap `summarizeBaseMeetingDemo` for `aiService.summarize`
6. Add `ANTHROPIC_API_KEY` and `NEXT_PUBLIC_AI_ENABLED=false` to environment
7. Enable `NEXT_PUBLIC_AI_ENABLED=true` for coordinator-only test, get feedback
8. Add prompt caching (`cache_control`) to system prompt block once quality is confirmed

**Risk**: Medium. Involves real API cost and Hebrew prompt quality validation. Feature flag (`NEXT_PUBLIC_AI_ENABLED`) ensures demo fallback is always available.
**Rollback**: Set `NEXT_PUBLIC_AI_ENABLED=false`.

---

### Phase 4 — Mobile Push Notifications (future, no timeline yet)
**Goal**: Reminders reach activists on their phones even when the CRM tab is closed.

**Prerequisites before starting**:
- Phase 1 (automatic trigger) must be complete
- Deployment platform confirmed (Vercel, self-hosted, etc.)
- iOS PWA strategy decided (iOS 16.4+ supports Web Push for installed PWAs)

**Steps** (high-level, to be detailed when Phase 3 is complete):
1. Add `phone` field to `data/users.js` schema
2. Create `public/sw.js` service worker
3. Create `pages/api/push/subscribe.js` — saves push subscription token
4. Create `pages/api/push/send.js` — sends Web Push via `web-push` package
5. Update `lib/reminderDelivery.js` — add `channel: 'push'` path
6. Test on Android Chrome (full support) then iOS Safari (PWA install required)

---

### Phase 5 — Production-Quality STT with Whisper (future, no timeline yet)
**Goal**: High-quality Hebrew transcription on all browsers including iOS Safari.

**Prerequisites**: Phase 2 (Web Speech) live and validated by activists.

**Steps** (high-level):
1. Install `openai` npm package (only at this phase)
2. Create `pages/api/transcribe.js` — accepts audio blob, calls Whisper API
3. Update `components/VoiceInput.jsx` — add `MediaRecorder` blob-upload path alongside Web Speech path
4. Add fallback: Web Speech on supported browsers, Whisper blob-upload on Safari

---

## Summary Table

| Phase | What it delivers | Packages added | Risk |
|---|---|---|---|
| 0 | Decisions + prompt testing | None | None |
| 1 | Automatic time-based reminder trigger + escalation | None | Low |
| 2 | Voice dictation (Hebrew) into form notes | None | Low |
| 3 | Real Claude AI summaries for submitted reports | None (fetch only) | Medium |
| 4 | Mobile push notifications | `web-push` | Medium |
| 5 | Whisper-quality STT on all browsers | `openai` | Low-Medium |

> Each phase is independently deployable and rollbackable.
> No phase requires changes to `lib/reminderSchedulerDemo.js` or `lib/notificationDemo.js` — these are stable foundations.
