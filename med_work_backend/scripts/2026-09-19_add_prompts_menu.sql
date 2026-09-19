-- ============================================================
-- 2026-09-19 提示词/Skill：侧边栏新增「提示词管理」菜单入口
-- 库：med_workbench（按需修改 USE）
-- 幂等：可重复执行
-- 说明：菜单挂在「智能诊疗中心」（clinical-hub）分组下，4 个内置角色全部授权。
--       注意：库里可能存在历史停用的 prompts 二期占位记录（id 不固定），
--       本脚本会在其存在时就地修正并重新启用。
-- ============================================================
USE med_workbench;

-- 1) 菜单项：不存在则插入
INSERT INTO `med_menus`
  (`parent_id`, `menu_key`, `route_key`, `title`, `icon_name`, `menu_type`, `phase2`, `sort_order`, `status`)
SELECT p.id, 'prompts', 'prompts', '提示词管理', 'ThunderboltOutlined', 'page', 0, 23, 'active'
FROM `med_menus` p
WHERE p.menu_key = 'clinical-hub'
  AND NOT EXISTS (SELECT 1 FROM `med_menus` m WHERE m.menu_key = 'prompts');

-- 2) 菜单项：已存在（含历史停用记录）则就地修正
UPDATE `med_menus` m
JOIN `med_menus` p ON p.menu_key = 'clinical-hub'
SET m.parent_id  = p.id,
    m.route_key  = 'prompts',
    m.title      = '提示词管理',
    m.icon_name  = 'ThunderboltOutlined',
    m.menu_type  = 'page',
    m.phase2     = 0,
    m.sort_order = 23,
    m.status     = 'active'
WHERE m.menu_key = 'prompts';

-- 3) 内置角色授权（hospital_admin / doctor / knowledge_admin / auditor）
INSERT INTO `med_role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id
FROM `med_roles` r
JOIN `med_menus` m ON m.menu_key = 'prompts'
WHERE r.role_code IN ('hospital_admin', 'doctor', 'knowledge_admin', 'auditor')
  AND NOT EXISTS (
    SELECT 1 FROM `med_role_menus` rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

-- 验证：SELECT m.menu_key, m.title, m.status, GROUP_CONCAT(r.role_code)
--       FROM med_menus m JOIN med_role_menus rm ON rm.menu_id = m.id
--       JOIN med_roles r ON r.id = rm.role_id WHERE m.menu_key = 'prompts' GROUP BY m.id;
