import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDraftConversation,
  visibleConversations,
} from '../src/stores/conversationState.ts';

test('recent conversations reuse a draft and only expose five items', () => {
  const conversations = Array.from({ length: 7 }, (_, index) => ({
    key: String(index + 1),
    label: index === 3 ? '新对话' : `会话 ${index + 1}`,
  }));

  assert.equal(findDraftConversation(conversations)?.key, '4');
  assert.deepEqual(visibleConversations(conversations), conversations.slice(0, 5));
});
