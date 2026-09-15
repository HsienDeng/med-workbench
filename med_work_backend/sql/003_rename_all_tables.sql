-- 003_rename_all_tables.sql
-- 将全库表名从旧前缀 mwb_ 统一改为 med_。
-- 执行前请确认无运行中的写入操作，避免 RENAME 期间锁表异常。
-- 适用于已存在 mwb_* 表的环境；新环境由 create_all / PrefixedAIOMySQLSaver.setup() 自动创建 med_* 表。

SET FOREIGN_KEY_CHECKS = 0;

-- 业务表
RENAME TABLE mwb_hospitals TO med_hospitals;
RENAME TABLE mwb_departments TO med_departments;
RENAME TABLE mwb_users TO med_users;
RENAME TABLE mwb_roles TO med_roles;
RENAME TABLE mwb_permissions TO med_permissions;
RENAME TABLE mwb_user_roles TO med_user_roles;
RENAME TABLE mwb_role_permissions TO med_role_permissions;
RENAME TABLE mwb_sessions TO med_sessions;
RENAME TABLE mwb_menus TO med_menus;
RENAME TABLE mwb_role_menus TO med_role_menus;
RENAME TABLE mwb_documents TO med_documents;
RENAME TABLE mwb_document_chunks TO med_document_chunks;

-- LangGraph 会话记忆表
RENAME TABLE mwb_checkpoint_migrations TO med_checkpoint_migrations;
RENAME TABLE mwb_checkpoints TO med_checkpoints;
RENAME TABLE mwb_checkpoint_blobs TO med_checkpoint_blobs;
RENAME TABLE mwb_checkpoint_writes TO med_checkpoint_writes;

SET FOREIGN_KEY_CHECKS = 1;
