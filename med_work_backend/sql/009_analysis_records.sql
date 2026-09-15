-- 009_analysis_records.sql
-- AI 病历分析记录：按医院/用户隔离，结果整存 JSON（沿用对话消息整存先例）。
-- 幂等：表已存在时不重建。
-- 对应后端模型：app/models/analysis_record.py AnalysisRecord

CREATE TABLE IF NOT EXISTS `med_analysis_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属医院ID，租户隔离',
  `user_id` BIGINT NOT NULL COMMENT '发起分析的用户ID',
  `patient_id` BIGINT NOT NULL COMMENT '患者ID',
  `medical_record_id` BIGINT NOT NULL COMMENT '病历记录ID',
  `analysis_type` VARCHAR(16) NOT NULL COMMENT '分析类型：record/medication/risk/exam',
  `model` VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'AI 模型名',
  `status` VARCHAR(16) NOT NULL DEFAULT 'done' COMMENT '状态：done/failed',
  `result` JSON NULL COMMENT '分析结果 {summary,attention,evidence}',
  `error` VARCHAR(500) NULL COMMENT '失败原因摘要',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_analysis_user` (`hospital_id`, `user_id`, `created_at`),
  KEY `ix_analysis_record` (`medical_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 病历分析记录';
