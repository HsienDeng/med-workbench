-- 007_wx_groups.sql
-- 企业微信外部群管理：群快照 / 群-患者绑定 / 群发推送记录。
-- 幂等：表已存在时不重建。后端启动时 Base.metadata.create_all 亦会自动建表，
-- 本脚本用于人工执行与线上排查。
-- 对应后端模型：app/models/wx.py WxGroup / WxGroupPatient / WxMessage

-- 外部群快照（企业维度，全局共享一份同步结果）
CREATE TABLE IF NOT EXISTS `med_wx_group` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `chat_id` VARCHAR(64) NOT NULL COMMENT '企微群ID',
  `name` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '群名',
  `owner` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '群主 userid（群发 sender）',
  `owner_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '群主姓名',
  `member_count` INT NOT NULL DEFAULT 0 COMMENT '成员总数',
  `external_count` INT NOT NULL DEFAULT 0 COMMENT '外部联系人数量',
  `status` INT NOT NULL DEFAULT 0 COMMENT '跟进状态：0正常/1离职待继承/2离职继承中/3离职继承完成',
  `last_sync_at` DATETIME NULL COMMENT '最近成功同步时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wx_group_chat_id` (`chat_id`),
  KEY `ix_wx_group_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业微信外部群快照';

-- 群-患者绑定（按医院隔离，同一医院内每群最多一位患者）
CREATE TABLE IF NOT EXISTS `med_wx_group_patient` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT NOT NULL COMMENT '所属医院ID，租户隔离',
  `group_id` BIGINT NOT NULL COMMENT '群ID',
  `patient_id` VARCHAR(64) NOT NULL COMMENT '患者ID',
  `patient_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '患者姓名快照',
  `bind_by` BIGINT NULL COMMENT '绑定操作人 user_id',
  `bind_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wx_bind_group` (`hospital_id`, `group_id`),
  KEY `ix_wx_bind_patient` (`hospital_id`, `patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群-患者绑定关系';

-- 群发推送记录（按医院隔离）
CREATE TABLE IF NOT EXISTS `med_wx_message` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT NOT NULL COMMENT '所属医院ID，租户隔离',
  `group_id` BIGINT NOT NULL COMMENT '群ID',
  `group_name` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '群名快照',
  `patient_id` VARCHAR(64) NULL COMMENT '推送时绑定的患者ID快照',
  `patient_name` VARCHAR(64) NULL COMMENT '推送时绑定的患者姓名快照',
  `msg_type` VARCHAR(16) NOT NULL COMMENT 'text / link',
  `title` VARCHAR(256) NULL COMMENT '链接卡片标题',
  `content` VARCHAR(4000) NULL COMMENT '文本内容 / 链接摘要',
  `url` VARCHAR(2048) NULL COMMENT '链接卡片跳转地址',
  `picurl` VARCHAR(2048) NULL COMMENT '链接卡片封面地址',
  `sender` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '群发 sender（群主 userid）',
  `operator_id` BIGINT NULL COMMENT '提交人 user_id',
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending / sent / fail',
  `fail_reason` VARCHAR(512) NULL COMMENT '失败原因',
  `wx_msgid` VARCHAR(128) NULL COMMENT '企微群发 msgid，用于回查结果',
  `wx_fail_list` JSON NULL COMMENT '提交时返回的失败群ID列表',
  `sent_at` DATETIME NULL COMMENT '企微侧最终发送时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_wx_msg_group` (`hospital_id`, `group_id`, `created_at`),
  KEY `ix_wx_msg_pending` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业微信群发推送记录';
