-- MedAI Workbench：动态菜单模型
-- 适用版本：MySQL 8.0+

USE med_workbench;

CREATE TABLE IF NOT EXISTS med_menus (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '菜单主键',
    parent_id BIGINT UNSIGNED NULL COMMENT '父级菜单ID',
    menu_key VARCHAR(64) NOT NULL COMMENT '菜单唯一键',
    route_key VARCHAR(64) NULL COMMENT '前端路由键，分组为空',
    title VARCHAR(64) NOT NULL COMMENT '菜单名称',
    icon_name VARCHAR(64) NULL COMMENT '图标组件名',
    badge VARCHAR(32) NULL COMMENT '菜单角标',
    menu_type VARCHAR(16) NOT NULL DEFAULT 'page' COMMENT '类型：group分组、page页面',
    phase2 TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否阶段二占位页',
    sort_order INT NOT NULL DEFAULT 0 COMMENT '同级顺序',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active启用、disabled停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_menus_key (menu_key),
    UNIQUE KEY med_uk_menus_route (route_key),
    KEY med_idx_menus_parent (parent_id, sort_order),
    KEY med_idx_menus_status (status),
    CONSTRAINT med_fk_menus_parent FOREIGN KEY (parent_id) REFERENCES med_menus (id),
    CONSTRAINT med_chk_menus_type CHECK (menu_type IN ('group', 'page')),
    CONSTRAINT med_chk_menus_status CHECK (status IN ('active', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '动态菜单表';

CREATE TABLE IF NOT EXISTS med_role_menus (
    role_id BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
    menu_id BIGINT UNSIGNED NOT NULL COMMENT '可见菜单ID',
    granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '授权时间',
    PRIMARY KEY (role_id, menu_id),
    KEY med_idx_role_menus_menu (menu_id, role_id),
    CONSTRAINT med_fk_role_menus_role FOREIGN KEY (role_id) REFERENCES med_roles (id) ON DELETE CASCADE,
    CONSTRAINT med_fk_role_menus_menu FOREIGN KEY (menu_id) REFERENCES med_menus (id) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '角色菜单关联表';
