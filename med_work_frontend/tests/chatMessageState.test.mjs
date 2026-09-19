import assert from 'node:assert/strict';
import test from 'node:test';
import { patchAssistantById, requestHistory, toPersist } from '../src/hooks/chatMessageState.ts';

test('a late callback cannot alter a different assistant message', () => {
  const messages = [{ id: 'new', role: 'assistant', content: 'new', status: 'loading' }];
  assert.strictEqual(patchAssistantById(messages, 'old', { content: 'late' }), messages);
  assert.equal(patchAssistantById(messages, 'new', { content: 'reply' })[0].content, 'reply');
});

test('errors and stopped replies never become model history', () => {
  const messages = [
    { id: 'u', role: 'user', content: 'question' },
    { id: 'e', role: 'assistant', content: 'network error', status: 'error' },
    { id: 's', role: 'assistant', content: 'partial', status: 'stopped' },
    { id: 'd', role: 'assistant', content: 'answer', status: 'done' },
  ];
  assert.deepEqual(requestHistory(messages), [messages[0], messages[3]]);
  assert.deepEqual(toPersist(messages).map(({ content }) => content), ['question', 'answer']);
});
