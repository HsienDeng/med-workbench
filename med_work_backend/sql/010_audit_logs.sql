-- 010_audit_logs.sql
-- 操作审计日志：记录谁在何时对哪条医疗数据做了什么，供追溯与合规。
-- 幂等：表已存在时不重建。
-- 对应后端模型：app/models/audit_log.py AuditLog
--
-- 说明：
-- - username/real_name 为操作时冗余快照，账号后续停用/删除不影响审计可读性；
-- - hospital_id 可为空：登录失败等尚无有效用户的场景允许匿名记录；
-- - detail 只写简短摘要（如患者编号），不落患者姓名等敏感字段。

CREATE TABLE IF NOT EXISTS `med_audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT NULL COMMENT '所属医院ID，租户隔离；登录失败等匿名场景可为空',
  `user_id` BIGINT NULL COMMENT '操作用户ID',
  `username` VARCHAR(64) NULL COMMENT '操作用户账号（冗余快照）',
  `real_name` VARCHAR(64) NULL COMMENT '操作用户姓名（冗余快照）',
  `ip` VARCHAR(45) NULL COMMENT '来源IP，兼容IPv4/IPv6',
  `user_agent` VARCHAR(255) NULL COMMENT '来源UA',
  `module` VARCHAR(32) NOT NULL COMMENT '功能模块：auth/patient/medical_record/analysis 等',
  `action` VARCHAR(32) NOT NULL COMMENT '操作：login/view/create/update/delete/parse/logout',
  `resource_type` VARCHAR(32) NULL COMMENT '资源类型：patient/medical_record/analysis_record 等',
  `resource_id` VARCHAR(64) NULL COMMENT '资源标识：患者编号/记录ID等',
  `detail` VARCHAR(500) NULL COMMENT '操作摘要（不含患者敏感字段）',
  `result` VARCHAR(16) NOT NULL DEFAULT 'success' COMMENT '结果：success/failure/denied',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '审计时间',
  PRIMARY KEY (`id`),
  KEY `ix_med_audit_hospital_time` (`hospital_id`, `created_at`),
  KEY `ix_med_audit_user_time` (`user_id`, `created_at`),
  KEY `ix_med_audit_module_action` (`module`, `action`, `created_at`),
  KEY `ix_med_audit_resource` (`resource_type`, `resource_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计日志';
