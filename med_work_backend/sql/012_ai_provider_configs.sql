-- 012: AI 供应商配置表（UI 可编辑的 API Key 管理）
-- 说明：实际建表由后端启动时 Base.metadata.create_all 自动完成，
-- 本文件作为结构文档与手工部署参考保留。
--
-- API Key 以 AES-GCM 加密存储（密文 = nonce(12) || tag+ct），
-- 加密密钥由环境变量 MED_API_KEY_ENC_KEY 派生（SHA-256），
-- 前端永远拿不到明文，仅返回 has_api_key / api_key_last4。

CREATE TABLE IF NOT EXISTS `med_ai_provider_configs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `hospital_id`     BIGINT       NOT NULL DEFAULT 1        COMMENT '所属医院ID（租户隔离）',
  `provider`        VARCHAR(64)  NOT NULL                  COMMENT '供应商唯一编码（小写字母/数字/连字符）',
  `display_name`    VARCHAR(128) NOT NULL                  COMMENT '显示名称',
  `protocol`        VARCHAR(32)  NOT NULL DEFAULT 'openai' COMMENT '协议：openai 兼容 / anthropic',
  `base_url`        VARCHAR(512) NOT NULL                  COMMENT 'API 基础地址（含 /v1）',
  `api_key_cipher`  VARBINARY(512) NULL                    COMMENT 'AES-GCM 加密后的 API Key',
  `api_key_last4`   CHAR(4)      NULL                      COMMENT 'Key 末 4 位（UI 遮蔽显示用）',
  `default_model`   VARCHAR(128) NOT NULL DEFAULT ''       COMMENT '默认调用模型',
  `cached_models`   JSON         NULL                      COMMENT '最近一次拉取的模型列表（候选下拉用）',
  `is_active`       TINYINT      NOT NULL DEFAULT 0        COMMENT '是否当前路由（单医院内至多一行=1）',
  `status`          VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active 启用 / disabled 停用',
  `sort_order`      INT          NOT NULL DEFAULT 100      COMMENT '显示顺序',
  `created_by`      VARCHAR(64)  NOT NULL DEFAULT 'system' COMMENT '创建人账号',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_provider_hospital` (`hospital_id`, `provider`),
  KEY `ix_ai_provider_active` (`hospital_id`, `is_active`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 供应商配置（UI 管理，替代 .env 硬编码）';
