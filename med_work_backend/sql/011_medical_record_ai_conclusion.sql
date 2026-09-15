-- 011_medical_record_ai_conclusion.sql
-- 病历增加「AI 分析结论归档」四列：结论快照 JSON + 归档时间 + 操作人 + 来源分析记录 id。
-- 对应后端模型：app/models/medical_record.py MedicalRecord（同步修改的映射列）
--
-- 说明：本脚本为幂等 ALTER，每个列分别按 information_schema 判断，
-- 列已存在则跳过（沿用 008_wx_webhook.sql 的先例）。
-- 需在 mysql 客户端执行（pymysql 不支持多语句），执行库为当前 DATABASE()。

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'med_medical_records'
      AND COLUMN_NAME = 'ai_conclusion'
);
SET @ddl = IF(
    @col_exists = 0,
    'ALTER TABLE med_medical_records ADD COLUMN ai_conclusion JSON NULL COMMENT ''归档的 AI 分析结论快照 {summary,attention,evidence}'' AFTER health_education',
    'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'med_medical_records'
      AND COLUMN_NAME = 'ai_conclusion_at'
);
SET @ddl = IF(
    @col_exists = 0,
    'ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_at DATETIME NULL COMMENT ''结论归档时间'' AFTER ai_conclusion',
    'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'med_medical_records'
      AND COLUMN_NAME = 'ai_conclusion_by'
);
SET @ddl = IF(
    @col_exists = 0,
    'ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_by BIGINT NULL COMMENT ''归档操作人 user_id'' AFTER ai_conclusion_at',
    'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'med_medical_records'
      AND COLUMN_NAME = 'ai_conclusion_source_id'
);
SET @ddl = IF(
    @col_exists = 0,
    'ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_source_id BIGINT NULL COMMENT ''来源 AI 分析记录 id（med_analysis_records.id）'' AFTER ai_conclusion_by',
    'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
