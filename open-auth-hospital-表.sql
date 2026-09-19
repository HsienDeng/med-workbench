/*
 Navicat Premium Dump SQL

 Source Server         : 106.52.98.236
 Source Server Type    : MySQL
 Source Server Version : 80045 (8.0.45)
 Source Host           : 106.52.98.236:3306
 Source Schema         : med_workbench

 Target Server Type    : MySQL
 Target Server Version : 80045 (8.0.45)
 File Encoding         : 65001

 Date: 19/09/2026 14:46:42
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for med_analysis_records
-- ----------------------------
DROP TABLE IF EXISTS `med_analysis_records`;
CREATE TABLE `med_analysis_records`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID，租户隔离',
  `user_id` bigint NOT NULL COMMENT '发起分析的用户ID',
  `patient_id` bigint NOT NULL COMMENT '患者ID',
  `medical_record_id` bigint NOT NULL COMMENT '病历记录ID',
  `analysis_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分析类型：record/medication/risk/exam',
  `model` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'AI 模型名',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '状态：done/failed',
  `result` json NULL COMMENT '分析结果 {summary,attention,evidence}',
  `error` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '失败原因摘要',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_analysis_record`(`medical_record_id` ASC) USING BTREE,
  INDEX `ix_analysis_user`(`hospital_id` ASC, `user_id` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for med_audit_logs
-- ----------------------------
DROP TABLE IF EXISTS `med_audit_logs`;
CREATE TABLE `med_audit_logs`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NULL DEFAULT NULL COMMENT '所属医院ID，租户隔离；登录失败等匿名场景可能为空',
  `user_id` bigint NULL DEFAULT NULL COMMENT '操作用户ID，快照值',
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '操作用户账号（冗余快照）',
  `real_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '操作用户姓名（冗余快照）',
  `ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '来源IP，兼容IPv4/IPv6',
  `user_agent` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '来源 UA',
  `module` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '功能模块：auth/patient/medical_record/analysis 等',
  `action` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '操作：login/view/create/update/delete/parse/logout',
  `resource_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '资源类型：patient/medical_record/analysis_record 等',
  `resource_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '资源标识：患者编号/记录ID等',
  `detail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '操作摘要（不含患者敏感字段）',
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '结果：success/failure/denied',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '审计时间（业务操作时间）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_med_audit_hospital_time`(`hospital_id` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_med_audit_resource`(`resource_type` ASC, `resource_id` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_med_audit_user_time`(`user_id` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_med_audit_module_action`(`module` ASC, `action` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 23 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for med_chat_conversations
-- ----------------------------
DROP TABLE IF EXISTS `med_chat_conversations`;
CREATE TABLE `med_chat_conversations`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID',
  `user_id` bigint NOT NULL COMMENT '所属用户ID',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '会话标题',
  `messages` json NOT NULL COMMENT '消息列表 [{role,content,status}]',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_chat_conv_user`(`hospital_id` ASC, `user_id` ASC, `deleted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_checkpoint_blobs
-- ----------------------------
DROP TABLE IF EXISTS `med_checkpoint_blobs`;
CREATE TABLE `med_checkpoint_blobs`  (
  `thread_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `checkpoint_ns` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '',
  `channel` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `version` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `type` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `blob` longblob NULL,
  `checkpoint_ns_hash` binary(16) NOT NULL,
  PRIMARY KEY (`thread_id`, `checkpoint_ns_hash`, `channel`, `version`) USING BTREE,
  INDEX `mwb_checkpoint_blobs_thread_id_idx`(`thread_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_checkpoint_migrations
-- ----------------------------
DROP TABLE IF EXISTS `med_checkpoint_migrations`;
CREATE TABLE `med_checkpoint_migrations`  (
  `v` int NOT NULL,
  PRIMARY KEY (`v`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_checkpoint_writes
-- ----------------------------
DROP TABLE IF EXISTS `med_checkpoint_writes`;
CREATE TABLE `med_checkpoint_writes`  (
  `thread_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `checkpoint_ns` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '',
  `checkpoint_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `task_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `idx` int NOT NULL,
  `channel` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `type` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `blob` longblob NOT NULL,
  `checkpoint_ns_hash` binary(16) NOT NULL,
  `task_path` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`thread_id`, `checkpoint_ns_hash`, `checkpoint_id`, `task_id`, `idx`) USING BTREE,
  INDEX `mwb_checkpoint_writes_thread_id_idx`(`thread_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_checkpoints
-- ----------------------------
DROP TABLE IF EXISTS `med_checkpoints`;
CREATE TABLE `med_checkpoints`  (
  `thread_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `checkpoint_ns` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '',
  `checkpoint_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `parent_checkpoint_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `type` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `checkpoint` json NOT NULL,
  `metadata` json NOT NULL,
  `checkpoint_ns_hash` binary(16) NOT NULL,
  PRIMARY KEY (`thread_id`, `checkpoint_ns_hash`, `checkpoint_id`) USING BTREE,
  INDEX `mwb_checkpoints_thread_id_idx`(`thread_id` ASC) USING BTREE,
  INDEX `mwb_checkpoints_checkpoint_id_idx`(`checkpoint_id` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_departments
-- ----------------------------
DROP TABLE IF EXISTS `med_departments`;
CREATE TABLE `med_departments`  (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '科室主键',
  `hospital_id` bigint UNSIGNED NOT NULL COMMENT '所属医院ID',
  `parent_id` bigint UNSIGNED NULL DEFAULT NULL COMMENT '上级科室ID，空值表示一级科室',
  `department_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '科室编码，同一医院内唯一',
  `department_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '科室名称',
  `department_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'clinical' COMMENT '科室类型：clinical临床、medical_tech医技、nursing护理、admin行政、other其他',
  `tree_level` smallint UNSIGNED NOT NULL DEFAULT 1 COMMENT '科室层级，一级科室为1',
  `tree_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '科室树路径，例如/1/5/',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '同级科室显示顺序，数值越小越靠前',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
  `deleted_at` datetime(3) NULL DEFAULT NULL COMMENT '软删除时间，空值表示未删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mwb_uk_departments_hospital_code`(`hospital_id` ASC, `department_code` ASC) USING BTREE,
  UNIQUE INDEX `mwb_uk_departments_id_hospital`(`id` ASC, `hospital_id` ASC) USING BTREE,
  INDEX `mwb_idx_departments_parent`(`hospital_id` ASC, `parent_id` ASC, `sort_order` ASC) USING BTREE,
  INDEX `mwb_idx_departments_status`(`hospital_id` ASC, `status` ASC, `deleted_at` ASC) USING BTREE,
  INDEX `mwb_fk_departments_parent`(`parent_id` ASC, `hospital_id` ASC) USING BTREE,
  CONSTRAINT `mwb_fk_departments_hospital` FOREIGN KEY (`hospital_id`) REFERENCES `med_hospitals` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mwb_fk_departments_parent` FOREIGN KEY (`parent_id`, `hospital_id`) REFERENCES `med_departments` (`id`, `hospital_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mwb_chk_departments_status` CHECK (`status` in (_utf8mb4'active',_utf8mb4'disabled')),
  CONSTRAINT `mwb_chk_departments_type` CHECK (`department_type` in (_utf8mb4'clinical',_utf8mb4'medical_tech',_utf8mb4'nursing',_utf8mb4'admin',_utf8mb4'other'))
) ENGINE = InnoDB AUTO_INCREMENT = 12 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '医院科室组织树' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_dictionaries
-- ----------------------------
DROP TABLE IF EXISTS `med_dictionaries`;
CREATE TABLE `med_dictionaries`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID',
  `dict_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字典编码（租户内唯一，程序引用用）',
  `dict_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字典名称',
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分类：clinical 临床 / lab 检验 / coding 编码体系 / business 业务',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '字典说明',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'active 启用 / disabled 停用',
  `builtin` tinyint(1) NOT NULL COMMENT '是否内置字典（内置不可删除）',
  `sort_order` int NOT NULL COMMENT '显示顺序',
  `created_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '创建人',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_dict_hospital_code`(`hospital_id` ASC, `dict_code` ASC) USING BTREE,
  INDEX `ix_dict_hospital_status`(`hospital_id` ASC, `status` ASC, `deleted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_dictionary_items
-- ----------------------------
DROP TABLE IF EXISTS `med_dictionary_items`;
CREATE TABLE `med_dictionary_items`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `dictionary_id` bigint NOT NULL COMMENT '所属字典ID',
  `item_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '项编码（程序引用用，字典内唯一）',
  `item_label` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '显示名称',
  `item_value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '项值（缺省与 item_code 相同）',
  `sort_order` int NOT NULL COMMENT '显示顺序',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'active 启用 / disabled 停用',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_dict_item_dict_status`(`dictionary_id` ASC, `status` ASC) USING BTREE,
  INDEX `ix_dict_item_dict_code`(`dictionary_id` ASC, `item_code` ASC) USING BTREE,
  CONSTRAINT `med_dictionary_items_ibfk_1` FOREIGN KEY (`dictionary_id`) REFERENCES `med_dictionaries` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 39 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_document_chunks
-- ----------------------------
DROP TABLE IF EXISTS `med_document_chunks`;
CREATE TABLE `med_document_chunks`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID',
  `document_id` bigint NOT NULL COMMENT '文档ID',
  `chunk_index` int NOT NULL COMMENT '分块序号（从0开始）',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分块文本',
  `char_count` int NOT NULL COMMENT '字符数',
  `point_id` varchar(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT 'Qdrant 中的点 ID',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '分块标题（章节名）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_doc_chunks_hospital`(`hospital_id` ASC) USING BTREE,
  INDEX `ix_doc_chunks_document`(`document_id` ASC) USING BTREE,
  CONSTRAINT `med_document_chunks_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `med_documents` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 519 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_documents
-- ----------------------------
DROP TABLE IF EXISTS `med_documents`;
CREATE TABLE `med_documents`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID',
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '文档标题',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '原始文件名',
  `file_ext` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '扩展名，如 .pdf',
  `file_size` bigint NOT NULL COMMENT '文件大小（字节）',
  `file_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '文件存储相对路径',
  `doc_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'guide/literature/drug/case/norm/other',
  `source` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '文档来源',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '备注',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'parsing/ready/failed',
  `chunk_count` int NOT NULL COMMENT '分块数',
  `vector_count` int NOT NULL COMMENT '已写入向量库的分块数',
  `error_message` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '解析/向量化失败原因',
  `created_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '上传人',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  `sub_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '子分类（专科/亚类）',
  `summary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT 'LLM 生成的文档摘要',
  `source_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'system' COMMENT '来源分类：system/ima',
  `source_media_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '来源媒体 ID（IMA 的 media_id，用于两步导入时二次取回内容）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_documents_hospital_deleted`(`hospital_id` ASC, `deleted_at` ASC) USING BTREE,
  INDEX `ix_documents_hospital_status`(`hospital_id` ASC, `status` ASC) USING BTREE,
  INDEX `ix_documents_source_media`(`source_media_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 38 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_hospitals
-- ----------------------------
DROP TABLE IF EXISTS `med_hospitals`;
CREATE TABLE `med_hospitals`  (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '医院主键',
  `hospital_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '医院唯一编码，同时作为租户编码',
  `hospital_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '医院全称',
  `short_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '医院简称',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
  `deleted_at` datetime(3) NULL DEFAULT NULL COMMENT '软删除时间，空值表示未删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mwb_uk_hospitals_code`(`hospital_code` ASC) USING BTREE,
  INDEX `mwb_idx_hospitals_status`(`status` ASC, `deleted_at` ASC) USING BTREE,
  CONSTRAINT `mwb_chk_hospitals_status` CHECK (`status` in (_utf8mb4'active',_utf8mb4'disabled'))
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '医院租户表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_medical_records
-- ----------------------------
DROP TABLE IF EXISTS `med_medical_records`;
CREATE TABLE `med_medical_records`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID，租户隔离',
  `patient_id` bigint NOT NULL COMMENT '患者ID',
  `chief_complaint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '主诉',
  `present_illness` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '现病史',
  `past_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '既往史',
  `allergy_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '过敏史',
  `drug_allergy_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '药敏史',
  `family_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '家族史',
  `physical_exam` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '体格检查',
  `treatment_advice` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '处理意见',
  `lab_tests` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '检验',
  `examinations` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '检查',
  `treatment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '治疗',
  `medications` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '药品',
  `supplements` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '补充内容',
  `health_education` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '健康教育',
  `ai_conclusion` json NULL COMMENT '归档的 AI 分析结论快照 {summary,attention,evidence}',
  `ai_conclusion_at` datetime NULL DEFAULT NULL COMMENT '结论归档时间',
  `ai_conclusion_by` bigint NULL DEFAULT NULL COMMENT '归档操作人 user_id',
  `ai_conclusion_source_id` bigint NULL DEFAULT NULL COMMENT '来源 AI 分析记录 id（med_analysis_records.id）',
  `created_by` bigint NULL DEFAULT NULL COMMENT '创建人 user_id',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_med_medical_records_created`(`patient_id` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_med_medical_records_patient`(`hospital_id` ASC, `patient_id` ASC, `deleted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_menus
-- ----------------------------
DROP TABLE IF EXISTS `med_menus`;
CREATE TABLE `med_menus`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `parent_id` bigint NULL DEFAULT NULL COMMENT '父级菜单ID',
  `menu_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '菜单唯一键',
  `route_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '前端路由键，分组为空',
  `title` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '菜单名称',
  `icon_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT 'Ant Design 图标名',
  `badge` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '菜单角标',
  `menu_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'group/page',
  `phase2` tinyint(1) NOT NULL COMMENT '是否阶段二占位页',
  `sort_order` int NOT NULL COMMENT '显示顺序',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'active/disabled',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `menu_key`(`menu_key` ASC) USING BTREE,
  INDEX `parent_id`(`parent_id` ASC) USING BTREE,
  CONSTRAINT `med_menus_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `med_menus` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 33 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_notifications
-- ----------------------------
DROP TABLE IF EXISTS `med_notifications`;
CREATE TABLE `med_notifications`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NULL DEFAULT NULL COMMENT '所属医院ID，租户隔离',
  `user_id` bigint NULL DEFAULT NULL COMMENT '接收用户ID',
  `type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '通知类型：analysis_failed / system 等',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '通知标题',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '通知正文',
  `resource_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '关联资源类型：analysis_record 等',
  `resource_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '关联资源ID',
  `is_read` tinyint(1) NOT NULL COMMENT '是否已读',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '通知时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_med_notifications_hospital_user_read`(`hospital_id` ASC, `user_id` ASC, `is_read` ASC) USING BTREE,
  INDEX `ix_med_notifications_user_time`(`user_id` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_med_notifications_user_id`(`user_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for med_patients
-- ----------------------------
DROP TABLE IF EXISTS `med_patients`;
CREATE TABLE `med_patients`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID，租户隔离',
  `patient_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '患者编号，后端自动生成',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '姓名',
  `gender` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '性别：male / female',
  `birth_date` date NULL DEFAULT NULL COMMENT '出生日期',
  `age` int NOT NULL COMMENT '年龄',
  `phone` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '手机号',
  `primary_diag` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '主诊断',
  `dept` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '科室（字典 department 的 item code）',
  `department_id` bigint NULL DEFAULT NULL COMMENT '所在组织科室ID(med_departments.id)，数据范围过滤用；NULL表示未纳入组织科室',
  `status` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '状态（字典 patient_status 的 item code）',
  `created_by` bigint NULL DEFAULT NULL COMMENT '创建人 user_id',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  `height` float NULL DEFAULT NULL COMMENT '身高（cm）',
  `weight` float NULL DEFAULT NULL COMMENT '体重（kg）',
  `bmi` float NULL DEFAULT NULL COMMENT 'BMI（自动计算）',
  `waistline` float NULL DEFAULT NULL COMMENT '腰围（cm）',
  `allergy_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '档案层常驻过敏史（与逐次病历的 allergy_history 区分）',
  `past_history` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '档案层常驻既往史',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_med_patients_no`(`hospital_id` ASC, `patient_no` ASC) USING BTREE,
  INDEX `ix_med_patients_name`(`hospital_id` ASC, `name` ASC, `deleted_at` ASC) USING BTREE,
  INDEX `ix_med_patients_status`(`hospital_id` ASC, `status` ASC, `deleted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_permissions
-- ----------------------------
DROP TABLE IF EXISTS `med_permissions`;
CREATE TABLE `med_permissions`  (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '权限主键',
  `permission_code` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '全局唯一权限编码，例如patient:view',
  `permission_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '权限名称',
  `module_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '所属功能模块编码',
  `resource_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '受保护资源编码',
  `action_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '操作编码，例如view、create、update、delete、review',
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '权限说明',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '权限显示顺序，数值越小越靠前',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mwb_uk_permissions_code`(`permission_code` ASC) USING BTREE,
  INDEX `mwb_idx_permissions_module`(`module_code` ASC, `resource_code` ASC, `sort_order` ASC) USING BTREE,
  INDEX `mwb_idx_permissions_status`(`status` ASC) USING BTREE,
  CONSTRAINT `mwb_chk_permissions_status` CHECK (`status` in (_utf8mb4'active',_utf8mb4'disabled'))
) ENGINE = InnoDB AUTO_INCREMENT = 41 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '全局权限点定义表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_role_menus
-- ----------------------------
DROP TABLE IF EXISTS `med_role_menus`;
CREATE TABLE `med_role_menus`  (
  `role_id` bigint NOT NULL,
  `menu_id` bigint NOT NULL,
  `granted_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`role_id`, `menu_id`) USING BTREE,
  INDEX `menu_id`(`menu_id` ASC) USING BTREE,
  CONSTRAINT `med_role_menus_ibfk_1` FOREIGN KEY (`menu_id`) REFERENCES `med_menus` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_role_permissions
-- ----------------------------
DROP TABLE IF EXISTS `med_role_permissions`;
CREATE TABLE `med_role_permissions`  (
  `hospital_id` bigint UNSIGNED NOT NULL COMMENT '所属医院ID，用于租户隔离',
  `role_id` bigint UNSIGNED NOT NULL COMMENT '角色ID',
  `permission_id` bigint UNSIGNED NOT NULL COMMENT '权限ID',
  `granted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '权限授予时间',
  PRIMARY KEY (`role_id`, `permission_id`) USING BTREE,
  INDEX `mwb_idx_role_permissions_permission`(`permission_id` ASC, `hospital_id` ASC) USING BTREE,
  INDEX `mwb_fk_role_permissions_role`(`role_id` ASC, `hospital_id` ASC) USING BTREE,
  CONSTRAINT `mwb_fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `med_permissions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `mwb_fk_role_permissions_role` FOREIGN KEY (`role_id`, `hospital_id`) REFERENCES `med_roles` (`id`, `hospital_id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '角色权限关联表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_roles
-- ----------------------------
DROP TABLE IF EXISTS `med_roles`;
CREATE TABLE `med_roles`  (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '角色主键',
  `hospital_id` bigint UNSIGNED NOT NULL COMMENT '所属医院ID',
  `role_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '角色编码，同一医院内唯一',
  `role_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '角色名称',
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '角色说明',
  `data_scope` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'self' COMMENT '数据范围：self本人、department本科室、department_tree本科室及下级、hospital全院',
  `is_system` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置角色：0否、1是',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
  `deleted_at` datetime(3) NULL DEFAULT NULL COMMENT '软删除时间，空值表示未删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mwb_uk_roles_hospital_code`(`hospital_id` ASC, `role_code` ASC) USING BTREE,
  UNIQUE INDEX `mwb_uk_roles_id_hospital`(`id` ASC, `hospital_id` ASC) USING BTREE,
  INDEX `mwb_idx_roles_status`(`hospital_id` ASC, `status` ASC, `deleted_at` ASC) USING BTREE,
  CONSTRAINT `mwb_fk_roles_hospital` FOREIGN KEY (`hospital_id`) REFERENCES `med_hospitals` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mwb_chk_roles_data_scope` CHECK (`data_scope` in (_utf8mb4'self',_utf8mb4'department',_utf8mb4'department_tree',_utf8mb4'hospital')),
  CONSTRAINT `mwb_chk_roles_status` CHECK (`status` in (_utf8mb4'active',_utf8mb4'disabled'))
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '医院级RBAC角色表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_sessions
-- ----------------------------
DROP TABLE IF EXISTS `med_sessions`;
CREATE TABLE `med_sessions`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `token_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '令牌SHA-256哈希',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `expires_at` datetime NOT NULL COMMENT '过期时间',
  `revoked_at` datetime NULL DEFAULT NULL COMMENT '撤销时间',
  `last_used_at` datetime NULL DEFAULT NULL COMMENT '最后使用时间',
  `ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '登录IP',
  `user_agent` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '客户端User-Agent',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `token_hash`(`token_hash` ASC) USING BTREE,
  INDEX `ix_mwb_sessions_user_id`(`user_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 133 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_user_roles
-- ----------------------------
DROP TABLE IF EXISTS `med_user_roles`;
CREATE TABLE `med_user_roles`  (
  `hospital_id` bigint UNSIGNED NOT NULL COMMENT '所属医院ID，用于租户隔离',
  `user_id` bigint UNSIGNED NOT NULL COMMENT '用户ID',
  `role_id` bigint UNSIGNED NOT NULL COMMENT '角色ID',
  `assigned_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '角色分配时间',
  `expires_at` datetime(3) NULL DEFAULT NULL COMMENT '角色授权到期时间，空值表示长期有效',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
  PRIMARY KEY (`user_id`, `role_id`) USING BTREE,
  INDEX `mwb_idx_user_roles_role`(`hospital_id` ASC, `role_id` ASC, `status` ASC) USING BTREE,
  INDEX `mwb_idx_user_roles_user`(`hospital_id` ASC, `user_id` ASC, `status` ASC) USING BTREE,
  INDEX `mwb_fk_user_roles_user`(`user_id` ASC, `hospital_id` ASC) USING BTREE,
  INDEX `mwb_fk_user_roles_role`(`role_id` ASC, `hospital_id` ASC) USING BTREE,
  CONSTRAINT `mwb_fk_user_roles_role` FOREIGN KEY (`role_id`, `hospital_id`) REFERENCES `med_roles` (`id`, `hospital_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `mwb_fk_user_roles_user` FOREIGN KEY (`user_id`, `hospital_id`) REFERENCES `med_users` (`id`, `hospital_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `mwb_chk_user_roles_expiry` CHECK ((`expires_at` is null) or (`expires_at` > `assigned_at`)),
  CONSTRAINT `mwb_chk_user_roles_status` CHECK (`status` in (_utf8mb4'active',_utf8mb4'disabled'))
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户角色关联表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_users
-- ----------------------------
DROP TABLE IF EXISTS `med_users`;
CREATE TABLE `med_users`  (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户主键',
  `hospital_id` bigint UNSIGNED NOT NULL COMMENT '所属医院ID',
  `primary_department_id` bigint UNSIGNED NULL DEFAULT NULL COMMENT '主科室ID',
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '登录账号，同一医院内唯一',
  `employee_no` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '医院工号，同一医院内唯一',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '密码哈希，仅允许Argon2id或bcrypt',
  `real_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '用户真实姓名',
  `gender` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '性别：male男、female女、unknown未知',
  `professional_title` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '职称或岗位名称',
  `mobile_ciphertext` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '加密后的手机号码',
  `mobile_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '规范化手机号的SHA-256哈希，用于精确检索',
  `email_ciphertext` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '加密后的电子邮箱',
  `avatar_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户头像地址',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '账号状态：pending待启用、active启用、locked锁定、disabled停用',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0 COMMENT '下次登录是否必须修改密码：0否、1是',
  `failed_login_count` smallint UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
  `locked_until` datetime(3) NULL DEFAULT NULL COMMENT '账号锁定截止时间',
  `last_login_at` datetime(3) NULL DEFAULT NULL COMMENT '最后登录时间',
  `last_login_ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '最后登录IP，兼容IPv4和IPv6',
  `password_changed_at` datetime(3) NULL DEFAULT NULL COMMENT '最近一次修改密码时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
  `deleted_at` datetime(3) NULL DEFAULT NULL COMMENT '软删除时间，空值表示未删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mwb_uk_users_hospital_username`(`hospital_id` ASC, `username` ASC) USING BTREE,
  UNIQUE INDEX `mwb_uk_users_id_hospital`(`id` ASC, `hospital_id` ASC) USING BTREE,
  UNIQUE INDEX `mwb_uk_users_hospital_employee_no`(`hospital_id` ASC, `employee_no` ASC) USING BTREE,
  INDEX `mwb_idx_users_department`(`hospital_id` ASC, `primary_department_id` ASC, `status` ASC) USING BTREE,
  INDEX `mwb_idx_users_mobile_hash`(`hospital_id` ASC, `mobile_hash` ASC) USING BTREE,
  INDEX `mwb_idx_users_name`(`hospital_id` ASC, `real_name` ASC) USING BTREE,
  INDEX `mwb_idx_users_status`(`hospital_id` ASC, `status` ASC, `deleted_at` ASC) USING BTREE,
  INDEX `mwb_fk_users_primary_department`(`primary_department_id` ASC, `hospital_id` ASC) USING BTREE,
  CONSTRAINT `mwb_fk_users_hospital` FOREIGN KEY (`hospital_id`) REFERENCES `med_hospitals` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mwb_fk_users_primary_department` FOREIGN KEY (`primary_department_id`, `hospital_id`) REFERENCES `med_departments` (`id`, `hospital_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `mwb_chk_users_gender` CHECK ((`gender` is null) or (`gender` in (_utf8mb4'male',_utf8mb4'female',_utf8mb4'unknown'))),
  CONSTRAINT `mwb_chk_users_status` CHECK (`status` in (_utf8mb4'pending',_utf8mb4'active',_utf8mb4'locked',_utf8mb4'disabled'))
) ENGINE = InnoDB AUTO_INCREMENT = 28 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '平台用户表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_wx_group
-- ----------------------------
DROP TABLE IF EXISTS `med_wx_group`;
CREATE TABLE `med_wx_group`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `chat_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '企微群ID',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '群名',
  `owner` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '群主 userid（群发 sender）',
  `owner_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '群主姓名',
  `member_count` int NOT NULL COMMENT '成员总数',
  `webhook_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '群机器人Webhook地址（手动建群/无企微凭证时的推送通道）',
  `wecomapi_room_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT 'wecomapi平台群ID(roomId)，第三方通道推送（试点）',
  `external_count` int NOT NULL COMMENT '外部联系人数量',
  `status` int NOT NULL COMMENT '跟进状态：0正常/1离职待继承/2离职继承中/3离职继承完成',
  `last_sync_at` datetime NULL DEFAULT NULL COMMENT '最近成功同步时间',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `chat_id`(`chat_id` ASC) USING BTREE,
  INDEX `ix_wx_group_status`(`status` ASC, `deleted_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_wx_group_patient
-- ----------------------------
DROP TABLE IF EXISTS `med_wx_group_patient`;
CREATE TABLE `med_wx_group_patient`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID，租户隔离',
  `group_id` bigint NOT NULL COMMENT '群ID',
  `patient_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '患者ID',
  `patient_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '患者姓名快照',
  `bind_by` bigint NULL DEFAULT NULL COMMENT '绑定操作人 user_id',
  `bind_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_wx_bind_group`(`hospital_id` ASC, `group_id` ASC) USING BTREE,
  INDEX `ix_wx_bind_patient`(`hospital_id` ASC, `patient_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for med_wx_message
-- ----------------------------
DROP TABLE IF EXISTS `med_wx_message`;
CREATE TABLE `med_wx_message`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hospital_id` bigint NOT NULL COMMENT '所属医院ID，租户隔离',
  `group_id` bigint NOT NULL COMMENT '群ID',
  `group_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '群名快照',
  `patient_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '推送时绑定的患者ID快照',
  `patient_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '推送时绑定的患者姓名快照',
  `msg_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'text / link',
  `title` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '链接卡片标题',
  `content` varchar(4000) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '文本内容 / 链接摘要',
  `url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '链接卡片跳转地址',
  `picurl` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '链接卡片封面地址',
  `sender` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '群发 sender（群主 userid）',
  `operator_id` bigint NULL DEFAULT NULL COMMENT '提交人 user_id',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'pending / sent / fail',
  `fail_reason` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '失败原因',
  `wx_msgid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '企微群发 msgid，用于回查结果',
  `wx_fail_list` json NULL COMMENT '提交时返回的失败群ID列表',
  `sent_at` datetime NULL DEFAULT NULL COMMENT '企微侧最终发送时间',
  `created_at` datetime NOT NULL DEFAULT (now()),
  `updated_at` datetime NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_wx_msg_pending`(`status` ASC, `created_at` ASC) USING BTREE,
  INDEX `ix_wx_msg_group`(`hospital_id` ASC, `group_id` ASC, `created_at` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;
