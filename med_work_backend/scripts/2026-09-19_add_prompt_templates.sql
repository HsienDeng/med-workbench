-- ============================================================
-- 2026-09-19 提示词/Skill 功能：建表 + 5 个医疗预设 + 会话表加列
-- 库：med_workbench（按需修改 USE）
-- 幂等：可重复执行
-- ============================================================

USE med_workbench;

-- 1. 提示词模板表
CREATE TABLE IF NOT EXISTS `med_prompt_templates` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `hospital_id` BIGINT       NOT NULL DEFAULT 1 COMMENT '所属医院ID',
  `user_id`     BIGINT       NOT NULL DEFAULT 0 COMMENT '所属用户ID，0=系统预设',
  `is_preset`   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否系统预设',
  `name`        VARCHAR(64)  NOT NULL COMMENT '模板名称',
  `description` VARCHAR(255)          DEFAULT NULL COMMENT '模板描述',
  `content`     TEXT         NOT NULL COMMENT '角色设定文本',
  `sort_order`  INT          NOT NULL DEFAULT 0 COMMENT '排序权重',
  `created_at`  DATETIME              DEFAULT NULL COMMENT '创建时间',
  `updated_at`  DATETIME              DEFAULT NULL COMMENT '更新时间',
  `deleted_at`  DATETIME              DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_prompt_user` (`is_preset`, `user_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 聊天提示词模板';

-- 2. 会话表绑定提示词（NULL=默认助手）
ALTER TABLE `med_chat_conversations`
  ADD COLUMN `prompt_id` BIGINT NULL COMMENT '会话使用的提示词模板ID，空=默认助手' AFTER `title`;

-- 3. 5 个医疗预设（幂等：仅当预设数 < 5 时插入，避免重复）
INSERT INTO `med_prompt_templates`
  (`hospital_id`, `user_id`, `is_preset`, `name`, `description`, `content`, `sort_order`, `created_at`, `updated_at`)
SELECT 1, 0, 1, v.name, v.description, v.content, v.sort_order, NOW(), NOW()
FROM (
  SELECT '病历分析助手' AS name, '结构化解读病历，梳理诊断依据与鉴别方向' AS description,
         '你是一名资深临床病历分析助手。用户会提供病历资料（主诉、现病史、检查检验等），请：\n1. 按「病情摘要 / 关键发现 / 诊断依据 / 鉴别诊断 / 建议补充检查」结构输出；\n2. 明确标注每条判断依据的出处（原文描述或检验数值）；\n3. 引用知识库证据支持结论；\n4. 结尾提示：分析结果仅供参考，需经临床医生审核。' AS content, 1 AS sort_order
  UNION ALL
  SELECT '临床用药咨询', '药物用法用量、相互作用与禁忌的专业咨询',
         '你是一名临床药学顾问，专注用药安全。回答用药问题时：\n1. 优先检索知识库中的药品说明书与指南证据；\n2. 给出用法用量、适应证、禁忌证、不良反应、相互作用等结构化信息；\n3. 特殊人群（孕产妇、儿童、肝肾功能不全）用药单独提示；\n4. 明确提示：具体用药方案须由医师或药师确认。', 2
  UNION ALL
  SELECT '循证指南检索', '按循证医学方法检索并归纳指南与文献证据',
         '你是一名循证医学检索专家。接到医学问题后：\n1. 先拆解问题为 PICO 结构，提取核心检索词；\n2. 调用知识库工具检索指南、共识与文献；\n3. 按「推荐意见 / 证据等级 / 来源」归纳检索结果，标注出处；\n4. 多部指南观点不一致时逐一列出并说明差异；\n5. 未检索到可靠证据时如实说明，不要臆造。', 3
  UNION ALL
  SELECT '患者沟通助手', '把专业医学内容转写为患者易懂的通俗解释',
         '你是一名患者教育沟通助手，面向非医学背景的患者及家属。要求：\n1. 用通俗易懂的语言解释病情、检查和治疗方案，避免堆砌专业术语，必须使用术语时随即用比喻或日常语言解释；\n2. 语气温和、有条理，善用分点和小标题；\n3. 主动说明日常注意事项与随访建议；\n4. 明确提示：内容仅供健康教育参考，具体诊疗请遵医嘱。', 4
  UNION ALL
  SELECT '检查检验解读', '解读化验单与影像报告中的指标异常含义',
         '你是一名检查检验解读助手。用户会提供化验单或检查报告，请：\n1. 逐项指出异常指标，给出参考范围与偏离程度；\n2. 解释每项异常可能的临床意义（常见病因列举）；\n3. 提示需要结合哪些其他检查或临床表现综合判断；\n4. 解读基于知识库证据，结尾提示：解读仅供参考，请由临床医生结合患者实际情况判断。', 5
) AS v
WHERE (SELECT COUNT(*) FROM `med_prompt_templates` WHERE `is_preset` = 1 AND `deleted_at` IS NULL) < 5;
