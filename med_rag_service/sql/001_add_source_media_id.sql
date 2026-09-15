-- 001: 为 IMA 两步式导入增加来源媒体 ID
--
-- 背景：从 IMA「同步到本地」时不下载正文，仅建一条占位记录；
--       后续点「开始索引」时，需要凭此 media_id 向 IMA 取回该文件的完整内容。
--       原表无此字段，第二步无从取回内容。
--
-- 执行方式（对已存在的库，create_all 不会自动加列）：
--   mysql -u <user> -p med_workbench < 001_add_source_media_id.sql
-- 或直接执行下面这条 ALTER（脚本已做幂等保护，见下方说明）。

ALTER TABLE `med_documents`
  ADD COLUMN `source_media_id` VARCHAR(128) NULL COMMENT '来源媒体 ID（IMA 的 media_id，用于两步导入时二次取回内容）'
  AFTER `source_type`;

-- 便于按来源定位待索引项
ALTER TABLE `med_documents`
  ADD INDEX `ix_documents_source_media` (`source_media_id`);
