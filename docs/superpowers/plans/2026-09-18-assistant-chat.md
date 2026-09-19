# Assistant Chat Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `/assistant` into the approved compact composer layout with safe Markdown and reliable streaming/session transitions.

**Architecture:** Keep the current Ant Design X UI and backend SSE contract. Attribute each stream callback to one message, render assistant text through XMarkdown, and persist snapshots by their captured conversation key.

**Tech Stack:** React 18, TypeScript, Ant Design X 2.9, Ant Design 6, `@ant-design/x-markdown`, Vite, Node 24 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-assistant-chat-design.md`

## Global Constraints

- No backend chat contract changes, SDK migration, attachment, voice, or A2UI controls.
- Keep global `新会话` as the only creation entry and preserve current conversation history and citation download.
- Four choices stay visibly preview-only and never enter the chat request.
- Preserve the user's existing uncommitted changes in the Assistant page and CSS.
- Run `npx tsc --noEmit --pretty false` from `med_work_frontend`; do not use a production build as validation.

---

### Task 1: Stream Ownership

**Files:**
- Modify: `med_work_frontend/src/hooks/useXChat.ts`
- Create: `med_work_frontend/src/hooks/chatMessageState.ts`
- Create: `med_work_frontend/tests/chatMessageState.test.mjs`

**Interfaces:**
- Produces `patchAssistantById(messages: XMessage[], id: string, patch: Partial<XMessage>): XMessage[]`, `requestHistory(messages: XMessage[]): XMessage[]`, and `toPersist(messages: XMessage[]): ChatMessageInput[]`.
- `onRequest(message: string): boolean` reports whether the controlled composer should clear.
- `onCancel(): void` aborts only the active request and marks its own assistant message stopped.

- [x] **Step 1: Write the state tests.**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { patchAssistantById, requestHistory } from '../src/hooks/chatMessageState.ts';

test('late reply does not alter another assistant message', () => {
  const messages = [{ id: 'new', role: 'assistant', content: 'new', status: 'loading' }];
  assert.deepEqual(patchAssistantById(messages, 'old', { content: 'late' }), messages);
});
test('failed and stopped assistant text is not sent back as model history', () => {
  const messages = [
    { id: 'u', role: 'user', content: 'question' },
    { id: 'e', role: 'assistant', content: 'network error', status: 'error' },
    { id: 's', role: 'assistant', content: 'partial', status: 'stopped' },
  ];
  assert.deepEqual(requestHistory(messages), [messages[0]]);
});
```

- [x] **Step 2: Run `node --test tests/chatMessageState.test.mjs` from `med_work_frontend`.** Tests were added with the implementation in one edit, so a missing-module run was not recorded.
- [x] **Step 3: Add the pure helpers, then update the Hook to use a request ID and `AbortController`.** Each callback first checks the current request ID; updates patch only its own assistant ID. `onCancel` invalidates the ID before aborting; a late callback is ignored. Successful empty responses become a readable error, and `onRequest` returns false for empty/loading input.

```ts
const requestId = botMsg.id;
const isCurrent = () => activeRequest.current?.id === requestId;
onUpdate: (full) => { if (isCurrent()) setMessages((prev) => patchAssistantById(prev, requestId, { content: full })); },
```

- [x] **Step 4: Run `node --test tests/chatMessageState.test.mjs` and `npx tsc --noEmit --pretty false`; both passed.**
- [x] **Step 5: Review the focused diff.** Do not commit over unrelated user edits.

### Task 2: Composer and Markdown

**Files:**
- Modify: `med_work_frontend/package.json`, `med_work_frontend/package-lock.json`
- Modify: `med_work_frontend/src/pages/Assistant/index.tsx`, `med_work_frontend/src/pages/Assistant/index.css`

**Interfaces:**
- Consumes `onRequest(message: string): boolean`, `onCancel(): void`, and `XMessage.status` from Task 1.
- Keeps the `Sender` controlled by `input`, with no change to the backend request body.

- [x] **Step 1: Install `@ant-design/x-markdown` compatible with the existing Ant Design X 2.9 dependency.**
- [x] **Step 2: Replace assistant plain-text rendering with `XMarkdown`, retaining user/error text and citations outside it.**

```tsx
<XMarkdown content={m.content} className="assistant-markdown x-markdown-light"
  escapeRawHtml openLinksInNewTab
  streaming={{ hasNextChunk: m.status === 'loading' }} />
```

- [x] **Step 3: Move the four existing selectors to a compact option row above `Sender`.** Keep a visible preview-only note; remove the current banner, three-column `Sender.header`, model footer, and `BorderBeam`. Use an icon-only circular submit action and stop action through the Sender API; clear `input` only when `onRequest(text)` returns true. Do not render attachment/microphone icons.
- [x] **Step 4: Replace composer CSS with the supplied reference's light border, shadow, spacing, and stable controls.** On mobile the option row scrolls horizontally; long Markdown tables/code scroll within the message width.
- [ ] **Step 5: Run `npx tsc --noEmit --pretty false`; inspect keyboard submission, multiline input, stop, focus, and option overflow at desktop/mobile widths.**

### Task 3: Session Persistence and End-to-End Check

**Files:**
- Modify: `med_work_frontend/src/pages/Assistant/index.tsx`
- Test: `med_work_frontend/tests/chatMessageState.test.mjs`

**Interfaces:**
- Consumes Task 1's targeted cancellation and Task 2's composer.
- Persists only user and terminal assistant messages under the conversation ID captured at scheduling time.

- [x] **Step 1: Extend the pure state test to assert that an in-progress, errored, or stopped assistant is excluded from persistence.**
- [x] **Step 2: Capture the conversation key and snapshot in the save effect, clearing only its timer on cleanup.** On switch/new conversation, cancel and flush the old conversation snapshot; do not read the new active key from a stale cleanup. Ignore an old detail response unless its key still matches the active conversation. Show a save/load failure message instead of silently claiming success.

```ts
const key = activeKey;
const snapshot = toPersist(messages);
const timer = window.setTimeout(() => void saveConversation(key, snapshot), 800);
return () => window.clearTimeout(timer);
```

- [ ] **Step 3: Run `node --test tests/chatMessageState.test.mjs` and `npx tsc --noEmit --pretty false`; expect passes.**
- [ ] **Step 4: Reuse Vite at `http://localhost:8080/assistant`; verify desktop, narrow desktop, and mobile.** Send, stop, switch history during a stream, return to history, create through the global sidebar, test Markdown code/table/link and citation rendering, and inspect empty/error states. If browser automation is unavailable, report the exact unverified interaction scope.
- [ ] **Step 5: Inspect `git diff --check` and `git status --short`; keep unrelated worktree changes intact.**
