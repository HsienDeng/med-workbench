-- MedAI Workbench：组织机构与 RBAC 权限模型
-- 适用版本：MySQL 8.0+
-- 初始化管理员默认禁用。启用账号前，必须使用后端生成的真实密码哈希
-- 替换占位值，禁止直接保存明文密码。

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE DATABASE IF NOT EXISTS med_workbench
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE med_workbench;

CREATE TABLE IF NOT EXISTS med_hospitals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '医院主键',
    hospital_code VARCHAR(32) NOT NULL COMMENT '医院唯一编码，同时作为租户编码',
    hospital_name VARCHAR(128) NOT NULL COMMENT '医院全称',
    short_name VARCHAR(64) NULL COMMENT '医院简称',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
    deleted_at DATETIME(3) NULL COMMENT '软删除时间，空值表示未删除',
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_hospitals_code (hospital_code),
    KEY med_idx_hospitals_status (status, deleted_at),
    CONSTRAINT med_chk_hospitals_status
        CHECK (status IN ('active', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '医院租户表';

CREATE TABLE IF NOT EXISTS med_departments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '科室主键',
    hospital_id BIGINT UNSIGNED NOT NULL COMMENT '所属医院ID',
    parent_id BIGINT UNSIGNED NULL COMMENT '上级科室ID，空值表示一级科室',
    department_code VARCHAR(32) NOT NULL COMMENT '科室编码，同一医院内唯一',
    department_name VARCHAR(128) NOT NULL COMMENT '科室名称',
    department_type VARCHAR(20) NOT NULL DEFAULT 'clinical'
        COMMENT '科室类型：clinical临床、medical_tech医技、nursing护理、admin行政、other其他',
    tree_level SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '科室层级，一级科室为1',
    tree_path VARCHAR(512) NULL COMMENT '科室树路径，例如/1/5/',
    sort_order INT NOT NULL DEFAULT 0 COMMENT '同级科室显示顺序，数值越小越靠前',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
    deleted_at DATETIME(3) NULL COMMENT '软删除时间，空值表示未删除',
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_departments_hospital_code (hospital_id, department_code),
    UNIQUE KEY med_uk_departments_id_hospital (id, hospital_id),
    KEY med_idx_departments_parent (hospital_id, parent_id, sort_order),
    KEY med_idx_departments_status (hospital_id, status, deleted_at),
    CONSTRAINT med_fk_departments_hospital
        FOREIGN KEY (hospital_id) REFERENCES med_hospitals (id),
    CONSTRAINT med_fk_departments_parent
        FOREIGN KEY (parent_id, hospital_id)
        REFERENCES med_departments (id, hospital_id),
    CONSTRAINT med_chk_departments_type
        CHECK (department_type IN ('clinical', 'medical_tech', 'nursing', 'admin', 'other')),
    CONSTRAINT med_chk_departments_status
        CHECK (status IN ('active', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '医院科室组织树';

CREATE TABLE IF NOT EXISTS med_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户主键',
    hospital_id BIGINT UNSIGNED NOT NULL COMMENT '所属医院ID',
    primary_department_id BIGINT UNSIGNED NULL COMMENT '主科室ID',
    username VARCHAR(64) NOT NULL COMMENT '登录账号，同一医院内唯一',
    employee_no VARCHAR(64) NULL COMMENT '医院工号，同一医院内唯一',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希，仅允许Argon2id或bcrypt',
    real_name VARCHAR(64) NOT NULL COMMENT '用户真实姓名',
    gender VARCHAR(16) NULL COMMENT '性别：male男、female女、unknown未知',
    professional_title VARCHAR(64) NULL COMMENT '职称或岗位名称',
    mobile_ciphertext VARCHAR(512) NULL COMMENT '加密后的手机号码',
    mobile_hash CHAR(64) NULL COMMENT '规范化手机号的SHA-256哈希，用于精确检索',
    email_ciphertext VARCHAR(512) NULL COMMENT '加密后的电子邮箱',
    avatar_url VARCHAR(512) NULL COMMENT '用户头像地址',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        COMMENT '账号状态：pending待启用、active启用、locked锁定、disabled停用',
    must_change_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '下次登录是否必须修改密码：0否、1是',
    failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
    locked_until DATETIME(3) NULL COMMENT '账号锁定截止时间',
    last_login_at DATETIME(3) NULL COMMENT '最后登录时间',
    last_login_ip VARCHAR(45) NULL COMMENT '最后登录IP，兼容IPv4和IPv6',
    password_changed_at DATETIME(3) NULL COMMENT '最近一次修改密码时间',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
    deleted_at DATETIME(3) NULL COMMENT '软删除时间，空值表示未删除',
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_users_hospital_username (hospital_id, username),
    UNIQUE KEY med_uk_users_hospital_employee_no (hospital_id, employee_no),
    UNIQUE KEY med_uk_users_id_hospital (id, hospital_id),
    KEY med_idx_users_department (hospital_id, primary_department_id, status),
    KEY med_idx_users_mobile_hash (hospital_id, mobile_hash),
    KEY med_idx_users_name (hospital_id, real_name),
    KEY med_idx_users_status (hospital_id, status, deleted_at),
    CONSTRAINT med_fk_users_hospital
        FOREIGN KEY (hospital_id) REFERENCES med_hospitals (id),
    CONSTRAINT med_fk_users_primary_department
        FOREIGN KEY (primary_department_id, hospital_id)
        REFERENCES med_departments (id, hospital_id),
    CONSTRAINT med_chk_users_gender
        CHECK (gender IS NULL OR gender IN ('male', 'female', 'unknown')),
    CONSTRAINT med_chk_users_status
        CHECK (status IN ('pending', 'active', 'locked', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '平台用户表';

CREATE TABLE IF NOT EXISTS med_roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '角色主键',
    hospital_id BIGINT UNSIGNED NOT NULL COMMENT '所属医院ID',
    role_code VARCHAR(64) NOT NULL COMMENT '角色编码，同一医院内唯一',
    role_name VARCHAR(64) NOT NULL COMMENT '角色名称',
    description VARCHAR(255) NULL COMMENT '角色说明',
    data_scope VARCHAR(20) NOT NULL DEFAULT 'self'
        COMMENT '数据范围：self本人、department本科室、department_tree本科室及下级、hospital全院',
    is_system TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置角色：0否、1是',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
    deleted_at DATETIME(3) NULL COMMENT '软删除时间，空值表示未删除',
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_roles_hospital_code (hospital_id, role_code),
    UNIQUE KEY med_uk_roles_id_hospital (id, hospital_id),
    KEY med_idx_roles_status (hospital_id, status, deleted_at),
    CONSTRAINT med_fk_roles_hospital
        FOREIGN KEY (hospital_id) REFERENCES med_hospitals (id),
    CONSTRAINT med_chk_roles_data_scope
        CHECK (data_scope IN ('self', 'department', 'department_tree', 'hospital')),
    CONSTRAINT med_chk_roles_status
        CHECK (status IN ('active', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '医院级RBAC角色表';

CREATE TABLE IF NOT EXISTS med_permissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '权限主键',
    permission_code VARCHAR(128) NOT NULL COMMENT '全局唯一权限编码，例如patient:view',
    permission_name VARCHAR(128) NOT NULL COMMENT '权限名称',
    module_code VARCHAR(64) NOT NULL COMMENT '所属功能模块编码',
    resource_code VARCHAR(64) NOT NULL COMMENT '受保护资源编码',
    action_code VARCHAR(32) NOT NULL COMMENT '操作编码，例如view、create、update、delete、review',
    description VARCHAR(255) NULL COMMENT '权限说明',
    sort_order INT NOT NULL DEFAULT 0 COMMENT '权限显示顺序，数值越小越靠前',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后更新时间',
    PRIMARY KEY (id),
    UNIQUE KEY med_uk_permissions_code (permission_code),
    KEY med_idx_permissions_module (module_code, resource_code, sort_order),
    KEY med_idx_permissions_status (status),
    CONSTRAINT med_chk_permissions_status
        CHECK (status IN ('active', 'disabled'))
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '全局权限点定义表';

CREATE TABLE IF NOT EXISTS med_user_roles (
    hospital_id BIGINT UNSIGNED NOT NULL COMMENT '所属医院ID，用于租户隔离',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    role_id BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
    assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '角色分配时间',
    expires_at DATETIME(3) NULL COMMENT '角色授权到期时间，空值表示长期有效',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active启用、disabled停用',
    PRIMARY KEY (user_id, role_id),
    KEY med_idx_user_roles_role (hospital_id, role_id, status),
    KEY med_idx_user_roles_user (hospital_id, user_id, status),
    CONSTRAINT med_fk_user_roles_user
        FOREIGN KEY (user_id, hospital_id)
        REFERENCES med_users (id, hospital_id) ON DELETE CASCADE,
    CONSTRAINT med_fk_user_roles_role
        FOREIGN KEY (role_id, hospital_id)
        REFERENCES med_roles (id, hospital_id) ON DELETE CASCADE,
    CONSTRAINT med_chk_user_roles_status
        CHECK (status IN ('active', 'disabled')),
    CONSTRAINT med_chk_user_roles_expiry
        CHECK (expires_at IS NULL OR expires_at > assigned_at)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '用户角色关联表';

CREATE TABLE IF NOT EXISTS med_role_permissions (
    hospital_id BIGINT UNSIGNED NOT NULL COMMENT '所属医院ID，用于租户隔离',
    role_id BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
    permission_id BIGINT UNSIGNED NOT NULL COMMENT '权限ID',
    granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '权限授予时间',
    PRIMARY KEY (role_id, permission_id),
    KEY med_idx_role_permissions_permission (permission_id, hospital_id),
    CONSTRAINT med_fk_role_permissions_role
        FOREIGN KEY (role_id, hospital_id)
        REFERENCES med_roles (id, hospital_id) ON DELETE CASCADE,
    CONSTRAINT med_fk_role_permissions_permission
        FOREIGN KEY (permission_id)
        REFERENCES med_permissions (id) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '角色权限关联表';

-- ---------------------------------------------------------------------------
-- 一期初始化数据
-- ---------------------------------------------------------------------------

START TRANSACTION;

INSERT INTO med_hospitals (hospital_code, hospital_name, short_name, status)
VALUES ('DEMO_HOSPITAL', '示范医院', '示范医院', 'active')
ON DUPLICATE KEY UPDATE
    hospital_name = VALUES(hospital_name),
    short_name = VALUES(short_name),
    status = VALUES(status);

SET @seed_hospital_id = (
    SELECT id FROM med_hospitals WHERE hospital_code = 'DEMO_HOSPITAL' LIMIT 1
);

-- 组织科室（顶层）种子（ADMIN 为管理科室，其余为演示初始值）。
-- 重要：服务启动时（app/services/seed.py: sync_departments_from_dictionary）会把「临床科室」
-- 业务字典与组织科室幂等对齐——大小写不敏感匹配并统一 code/名称、补齐字典已有而组织树缺失的科室。
-- 因此临床科室的最终 code 以业务字典 department 项为准（如 CARDIOLOGY 会归一为 cardiology），
-- 患者档案的 dept 字典 code 与 med_departments.department_code 一一对应，供数据范围过滤解析。
INSERT INTO med_departments (
    hospital_id, parent_id, department_code, department_name,
    department_type, tree_level, sort_order, status
)
VALUES
    (@seed_hospital_id, NULL, 'ADMIN', '医院管理', 'admin', 1, 10, 'active'),
    (@seed_hospital_id, NULL, 'CARDIOLOGY', '心内科', 'clinical', 1, 20, 'active'),
    (@seed_hospital_id, NULL, 'RESPIRATORY', '呼吸内科', 'clinical', 1, 30, 'active'),
    (@seed_hospital_id, NULL, 'NURSING', '护理部', 'nursing', 1, 40, 'active')
ON DUPLICATE KEY UPDATE
    department_name = VALUES(department_name),
    department_type = VALUES(department_type),
    sort_order = VALUES(sort_order),
    status = VALUES(status);

INSERT INTO med_roles (
    hospital_id, role_code, role_name, description, data_scope, is_system, status
)
VALUES
    (@seed_hospital_id, 'hospital_admin', '医院管理员', '管理本医院组织、用户与角色', 'hospital', 1, 'active'),
    (@seed_hospital_id, 'doctor', '医生', '查看患者并执行、审核 AI 分析', 'department_tree', 1, 'active'),
    (@seed_hospital_id, 'knowledge_admin', '知识库管理员', '维护和审核知识库文档', 'hospital', 1, 'active'),
    (@seed_hospital_id, 'auditor', '审计员', '查看操作与分析审核记录', 'hospital', 1, 'active')
ON DUPLICATE KEY UPDATE
    role_name = VALUES(role_name),
    description = VALUES(description),
    data_scope = VALUES(data_scope),
    status = VALUES(status);

INSERT INTO med_permissions (
    permission_code, permission_name, module_code,
    resource_code, action_code, description, sort_order, status
)
VALUES
    ('dashboard:view', '查看工作台', 'dashboard', 'dashboard', 'view', NULL, 10, 'active'),
    ('analysis:create', '创建分析任务', 'analysis', 'analysis_task', 'create', NULL, 20, 'active'),
    ('analysis:view', '查看分析结果', 'analysis', 'analysis_result', 'view', NULL, 21, 'active'),
    ('analysis:review', '审核分析结果', 'analysis', 'analysis_result', 'review', NULL, 22, 'active'),
    ('analysis:retry', '重试分析任务', 'analysis', 'analysis_task', 'retry', NULL, 23, 'active'),
    ('patient:view', '查看患者档案', 'patient', 'patient', 'view', NULL, 30, 'active'),
    ('patient:create', '新建患者档案', 'patient', 'patient', 'create', NULL, 31, 'active'),
    ('patient:update', '更新患者档案', 'patient', 'patient', 'update', NULL, 32, 'active'),
    ('patient:import', '导入患者档案', 'patient', 'patient', 'import', NULL, 33, 'active'),
    ('patient:export', '导出患者档案', 'patient', 'patient', 'export', NULL, 34, 'active'),
    ('knowledge:view', '查看知识库', 'knowledge', 'knowledge_base', 'view', NULL, 40, 'active'),
    ('knowledge_document:view', '查看知识文档', 'knowledge', 'knowledge_document', 'view', NULL, 41, 'active'),
    ('knowledge_document:upload', '上传知识文档', 'knowledge', 'knowledge_document', 'upload', NULL, 42, 'active'),
    ('knowledge_document:update', '更新知识文档', 'knowledge', 'knowledge_document', 'update', NULL, 43, 'active'),
    ('knowledge_document:review', '审核知识文档', 'knowledge', 'knowledge_document', 'review', NULL, 44, 'active'),
    ('knowledge_document:delete', '删除知识文档', 'knowledge', 'knowledge_document', 'delete', NULL, 45, 'active'),
    ('organization:user:view', '查看用户', 'organization', 'user', 'view', NULL, 50, 'active'),
    ('organization:user:manage', '管理用户', 'organization', 'user', 'manage', NULL, 51, 'active'),
    ('organization:role:view', '查看角色权限', 'organization', 'role', 'view', NULL, 52, 'active'),
    ('organization:role:manage', '管理角色权限', 'organization', 'role', 'manage', NULL, 53, 'active'),
    ('audit:view', '查看审计记录', 'audit', 'audit_log', 'view', NULL, 60, 'active')
ON DUPLICATE KEY UPDATE
    permission_name = VALUES(permission_name),
    module_code = VALUES(module_code),
    resource_code = VALUES(resource_code),
    action_code = VALUES(action_code),
    description = VALUES(description),
    sort_order = VALUES(sort_order),
    status = VALUES(status);

SET @seed_admin_department_id = (
    SELECT id
    FROM med_departments
    WHERE hospital_id = @seed_hospital_id AND department_code = 'ADMIN'
    LIMIT 1
);

INSERT INTO med_users (
    hospital_id, primary_department_id, username, employee_no,
    password_hash, real_name, professional_title, status, must_change_password
)
VALUES (
    @seed_hospital_id,
    @seed_admin_department_id,
    'admin',
    'ADMIN-001',
    '!SET_PASSWORD_BEFORE_ENABLE!',
    '系统管理员',
    '平台管理员',
    'disabled',
    1
)
ON DUPLICATE KEY UPDATE
    primary_department_id = VALUES(primary_department_id),
    real_name = VALUES(real_name),
    professional_title = VALUES(professional_title);

SET @seed_admin_user_id = (
    SELECT id
    FROM med_users
    WHERE hospital_id = @seed_hospital_id AND username = 'admin'
    LIMIT 1
);

SET @seed_admin_role_id = (
    SELECT id
    FROM med_roles
    WHERE hospital_id = @seed_hospital_id AND role_code = 'hospital_admin'
    LIMIT 1
);

INSERT INTO med_user_roles (hospital_id, user_id, role_id, status)
VALUES (@seed_hospital_id, @seed_admin_user_id, @seed_admin_role_id, 'active')
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO med_role_permissions (hospital_id, role_id, permission_id)
SELECT @seed_hospital_id, @seed_admin_role_id, p.id
FROM med_permissions AS p
WHERE p.status = 'active'
ON DUPLICATE KEY UPDATE granted_at = granted_at;

INSERT INTO med_role_permissions (hospital_id, role_id, permission_id)
SELECT @seed_hospital_id, r.id, p.id
FROM med_roles AS r
JOIN med_permissions AS p
    ON (
        r.role_code = 'doctor'
        AND p.permission_code IN (
            'dashboard:view',
            'analysis:create', 'analysis:view', 'analysis:review', 'analysis:retry',
            'patient:view', 'patient:create', 'patient:update',
            'knowledge:view', 'knowledge_document:view'
        )
    )
    OR (
        r.role_code = 'knowledge_admin'
        AND p.permission_code IN (
            'dashboard:view', 'knowledge:view',
            'knowledge_document:view', 'knowledge_document:upload',
            'knowledge_document:update', 'knowledge_document:review',
            'knowledge_document:delete'
        )
    )
    OR (
        r.role_code = 'auditor'
        AND p.permission_code IN (
            'dashboard:view', 'analysis:view', 'audit:view'
        )
    )
WHERE r.hospital_id = @seed_hospital_id
  AND r.status = 'active'
  AND p.status = 'active'
ON DUPLICATE KEY UPDATE granted_at = granted_at;

COMMIT;
