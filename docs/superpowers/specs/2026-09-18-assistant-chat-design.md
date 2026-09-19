# Assistant chat refinement

## Scope

Refine the existing `/assistant` frontend without changing the backend chat contract. Keep the global sidebar's `新会话` as the only creation entry, the existing conversation history, citation downloads, and the current preview-only patient, knowledge, task, and model choices. Do not introduce attachment, voice, A2UI cards, or an SDK migration without a working corresponding contract.

## Layout

Replace the current composite composer (blue preview banner, three-column controls, model footer, animated border) with a compact row of four option controls above a separate input box. Adapt the supplied reference image for spacing, light border, subtle shadow, and circular send action, but use the existing medical-workbench labels rather than the image's example shortcuts. A short visible note identifies the options as previews that do not affect the answer. No nonfunctional attachment or microphone controls are shown.

The input grows to multiple lines without moving its action controls unexpectedly. During streaming, the send action becomes stop. On narrow screens, options scroll horizontally and the input retains usable width. Preserve the existing conversation list and message workspace; maintain keyboard focus, labels, and visible loading/error/empty states.

## Messages and data flow

Continue to use Ant Design X `Bubble.List` and `Sender` with the current `/api/chat/stream` SSE and conversation endpoints. Render assistant message content with `@ant-design/x-markdown`; user content and errors remain plain text. Markdown must not enable raw HTML, and long code, tables, and links must not overflow the message column. Keep citations outside the Markdown body.

The current frontend chat hook remains the state owner. A request is associated with its assistant message and conversation so callbacks from a canceled or superseded request cannot update another message or session. Submit clears the controlled input only when accepted. Cancel stops the request and leaves an explicit stopped state; a conversation switch cancels the active stream before replacing messages. Conversation persistence uses the correct conversation key and complete messages, including on switch, without allowing a stale asynchronous load to replace a newer active view. Existing preview selections never enter the chat payload.

## Failures and verification

Connection and stream failures produce a readable assistant error without leaving the composer stuck in loading. Empty responses and a canceled response are distinguishable from a completed answer. Failed conversation loads retain an actionable error rather than silently showing an empty conversation; failed saves must not masquerade as success.

Check type safety with `npx tsc --noEmit --pretty false`, focused checks for request/cancel/switch/save behavior, and browser verification at desktop, narrow desktop, and mobile sizes. Verify send, stop, history switching, Markdown with code/table/link, citation display, and empty/error states. Reuse the running Vite server if available.
