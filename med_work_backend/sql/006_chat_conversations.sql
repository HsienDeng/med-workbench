-- 006_chat_conversations.sql
-- AI 助手对话持久化：会话表（消息整存 JSON），按用户隔离。
-- 幂等：表已存在时不重建。
-- 对应后端模型：app/models/chat.py ChatConversation

CREATE TABLE IF NOT EXISTS `med_chat_conversations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属医院ID',
  `user_id` BIGINT NOT NULL COMMENT '所属用户ID',
  `title` VARCHAR(128) NOT NULL DEFAULT '新对话' COMMENT '会话标题',
  `messages` JSON NOT NULL COMMENT '消息列表 [{role,content,status}]',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_chat_conv_user` (`hospital_id`, `user_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 助手对话会话';
