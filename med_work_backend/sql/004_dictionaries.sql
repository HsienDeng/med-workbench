-- 004_dictionaries.sql
-- 数据字典：字典主表 + 字典项表。
-- 新环境由 Base.metadata.create_all 自动建表，本脚本用于手工建库或核对结构。

CREATE TABLE IF NOT EXISTS `med_dictionaries` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `hospital_id` BIGINT       NOT NULL DEFAULT 1 COMMENT '所属医院ID',
  `dict_code`   VARCHAR(64)  NOT NULL COMMENT '字典编码（租户内唯一，程序引用用）',
  `dict_name`   VARCHAR(128) NOT NULL COMMENT '字典名称',
  `category`    VARCHAR(32)  NOT NULL DEFAULT 'business' COMMENT '分类：clinical 临床 / lab 检验 / coding 编码体系 / business 业务',
  `description` VARCHAR(500) DEFAULT NULL COMMENT '字典说明',
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active 启用 / disabled 停用',
  `builtin`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否内置字典（内置不可删除）',
  `sort_order`  INT          NOT NULL DEFAULT 0 COMMENT '显示顺序',
  `created_by`  VARCHAR(64)  NOT NULL DEFAULT 'system' COMMENT '创建人',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_dict_hospital_status` (`hospital_id`, `status`, `deleted_at`),
  KEY `ix_dict_hospital_code` (`hospital_id`, `dict_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='数据字典主表';

CREATE TABLE IF NOT EXISTS `med_dictionary_items` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `dictionary_id` BIGINT       NOT NULL COMMENT '所属字典ID',
  `item_code`     VARCHAR(64)  NOT NULL COMMENT '项编码（程序引用用，字典内唯一）',
  `item_label`    VARCHAR(255) NOT NULL COMMENT '显示名称',
  `item_value`    VARCHAR(255) DEFAULT NULL COMMENT '项值（缺省与 item_code 相同）',
  `sort_order`    INT          NOT NULL DEFAULT 0 COMMENT '显示顺序',
  `status`        VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active 启用 / disabled 停用',
  `remark`        VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_dict_item_dict_status` (`dictionary_id`, `status`),
  KEY `ix_dict_item_dict_code` (`dictionary_id`, `item_code`),
  CONSTRAINT `fk_dict_item_dictionary` FOREIGN KEY (`dictionary_id`)
    REFERENCES `med_dictionaries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='数据字典项';
