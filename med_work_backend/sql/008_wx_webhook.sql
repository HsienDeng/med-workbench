-- 008_wx_webhook.sql
-- 手动建群 + Webhook 推送通道：med_wx_group 增加 webhook_url 列
--
-- 注意：应用启动时 app/services/seed.py 的 _ensure_columns 已自动执行此迁移
-- （幂等，仅列缺失时补列）。本脚本仅提供给 DBA 手工执行或非 FastAPI 环境使用。
-- 需在 mysql 客户端执行（pymysql 不支持多语句）。

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'med_wx_group'
      AND COLUMN_NAME = 'webhook_url'
);

SET @ddl = IF(
    @col_exists = 0,
    'ALTER TABLE med_wx_group ADD COLUMN webhook_url VARCHAR(512) NULL COMMENT ''群机器人Webhook地址（手动建群/无企微凭证时的推送通道）'' AFTER member_count',
    'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
