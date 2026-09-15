-- 005_doc_fields_dictionaries.sql
-- 文档管理页「文档类型 / 索引状态 / 来源分类」接入数据字典。
-- 幂等：UPDATE 标签对齐到目标值；字典/项缺失时才 INSERT，已存在的不删改。
-- 对应后端种子：app/services/dictionary_service.py DICTIONARY_SEED

SET @hid := 1;

-- 1) doc_type：把已有项的显示名对齐到前端既有文案（不增删项）
UPDATE `med_dictionary_items` i
JOIN `med_dictionaries` d ON d.id = i.dictionary_id
SET i.item_label = CASE i.item_code
  WHEN 'guide'      THEN '临床指南'
  WHEN 'literature' THEN '医学文献'
  WHEN 'drug'       THEN '药品说明书'
  WHEN 'norm'       THEN '院内规范'
  WHEN 'case'       THEN '疑难病例'
  ELSE i.item_label
  END
WHERE d.dict_code = 'doc_type'
  AND d.hospital_id = @hid
  AND d.deleted_at IS NULL
  AND i.item_code IN ('guide', 'literature', 'drug', 'norm', 'case');

-- 2) index_status 字典（缺失时插入）
INSERT INTO `med_dictionaries`
  (`hospital_id`, `dict_code`, `dict_name`, `category`, `description`, `status`, `builtin`, `sort_order`, `created_by`)
SELECT @hid, 'index_status', '索引状态', 'business', '知识库文档的索引处理状态，与文档管理筛选保持一致', 'active', 1, 60, 'system'
WHERE NOT EXISTS (
  SELECT 1 FROM `med_dictionaries`
  WHERE hospital_id = @hid AND dict_code = 'index_status' AND deleted_at IS NULL
);

SET @ds := (SELECT id FROM `med_dictionaries` WHERE hospital_id = @hid AND dict_code = 'index_status' AND deleted_at IS NULL LIMIT 1);
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @ds, 'uploaded', '未索引', 'uploaded', 10, 'active' FROM DUAL
WHERE @ds IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @ds AND item_code = 'uploaded');
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @ds, 'parsing', '处理中', 'parsing', 20, 'active' FROM DUAL
WHERE @ds IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @ds AND item_code = 'parsing');
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @ds, 'ready', '已索引', 'ready', 30, 'active' FROM DUAL
WHERE @ds IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @ds AND item_code = 'ready');
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @ds, 'failed', '索引失败', 'failed', 40, 'active' FROM DUAL
WHERE @ds IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @ds AND item_code = 'failed');

-- 3) source_type 字典（缺失时插入）
INSERT INTO `med_dictionaries`
  (`hospital_id`, `dict_code`, `dict_name`, `category`, `description`, `status`, `builtin`, `sort_order`, `created_by`)
SELECT @hid, 'source_type', '来源分类', 'business', '知识库文档的来源分类：本地上传 / IMA 搬运', 'active', 1, 70, 'system'
WHERE NOT EXISTS (
  SELECT 1 FROM `med_dictionaries`
  WHERE hospital_id = @hid AND dict_code = 'source_type' AND deleted_at IS NULL
);

SET @st := (SELECT id FROM `med_dictionaries` WHERE hospital_id = @hid AND dict_code = 'source_type' AND deleted_at IS NULL LIMIT 1);
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @st, 'system', '本地上传', 'system', 10, 'active' FROM DUAL
WHERE @st IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @st AND item_code = 'system');
INSERT INTO `med_dictionary_items` (`dictionary_id`, `item_code`, `item_label`, `item_value`, `sort_order`, `status`)
SELECT @st, 'ima', 'IMA 搬运', 'ima', 20, 'active' FROM DUAL
WHERE @st IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `med_dictionary_items` WHERE dictionary_id = @st AND item_code = 'ima');
