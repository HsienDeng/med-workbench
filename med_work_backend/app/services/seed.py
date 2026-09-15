"""数据库初始化：建表与 RBAC 管理员账号激活。"""
import logging

from sqlalchemy import inspect, select, text

from app.database import Base, SessionLocal, engine
from app.models import Department, Dictionary, DictionaryItem, Hospital, Patient, RbacUser
from app.security import hash_password
from app.services import auth_service
from app.services import dictionary_service
from app.services import menu_service
from app.services import permission_service

logger = logging.getLogger(__name__)

# 初始化管理员默认密码：
# 仅当数据库中 admin 的 password_hash 仍是占位符（!SET_PASSWORD_BEFORE_ENABLE!）
# 且状态为 disabled（即 sql/001_organization_rbac.sql 的初始种子状态）时才会生效。
DEFAULT_ADMIN_PASSWORD = "Admin@123"


def init_db() -> None:
    """建表并初始化 RBAC 管理员账号。

    数据库不可用时降级为日志告警，保证服务可启动、健康检查可暴露问题。
    """
    try:
        Base.metadata.create_all(bind=engine)
        _ensure_columns(engine)
    except Exception as exc:  # noqa: BLE001
        logger.error("Database init failed, service continues without DB: %s", exc)
        return

    with SessionLocal() as db:
        try:
            _ensure_admin_ready(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Admin initialization skipped: %s", exc)
        try:
            menu_service.sync_menu_seed(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Dynamic menu initialization skipped: %s", exc)
        try:
            permission_service.sync_permission_seed(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Permission initialization skipped: %s", exc)
        try:
            dictionary_service.sync_dictionary_seed(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Dictionary initialization skipped: %s", exc)
        try:
            sync_departments_from_dictionary(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Organization department sync skipped: %s", exc)
        try:
            backfill_patient_departments(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Patient department backfill skipped: %s", exc)
        try:
            removed = auth_service.cleanup_expired_sessions(db)
            if removed:
                logger.info("Cleaned %d expired/revoked sessions", removed)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Session cleanup skipped: %s", exc)


_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    # (table, column, ddl)
    ("med_documents", "sub_type", "ALTER TABLE med_documents ADD COLUMN sub_type VARCHAR(64) NULL COMMENT '子分类（专科/亚类）'"),
    ("med_documents", "source_type", "ALTER TABLE med_documents ADD COLUMN source_type VARCHAR(16) NOT NULL DEFAULT 'system' COMMENT '来源分类：system/ima'"),
    ("med_documents", "summary", "ALTER TABLE med_documents ADD COLUMN summary TEXT NULL COMMENT 'LLM 生成的文档摘要'"),
    ("med_document_chunks", "title", "ALTER TABLE med_document_chunks ADD COLUMN title VARCHAR(255) NULL COMMENT '分块标题（章节名）'"),
    ("med_wx_group", "webhook_url", "ALTER TABLE med_wx_group ADD COLUMN webhook_url VARCHAR(512) NULL COMMENT '群机器人Webhook地址（手动建群/无企微凭证时的推送通道）' AFTER member_count"),
    ("med_patients", "height", "ALTER TABLE med_patients ADD COLUMN height FLOAT NULL COMMENT '身高（cm）'"),
    ("med_patients", "weight", "ALTER TABLE med_patients ADD COLUMN weight FLOAT NULL COMMENT '体重（kg）'"),
    ("med_patients", "bmi", "ALTER TABLE med_patients ADD COLUMN bmi FLOAT NULL COMMENT 'BMI（自动计算）'"),
    ("med_patients", "waistline", "ALTER TABLE med_patients ADD COLUMN waistline FLOAT NULL COMMENT '腰围（cm）'"),
    (
        "med_patients",
        "department_id",
        "ALTER TABLE med_patients ADD COLUMN department_id BIGINT NULL COMMENT '所在组织科室ID(med_departments.id)，数据范围过滤用；NULL表示未纳入组织科室' AFTER dept",
    ),
    ("med_wx_group", "wecomapi_room_id", "ALTER TABLE med_wx_group ADD COLUMN wecomapi_room_id VARCHAR(64) NULL COMMENT 'wecomapi平台群ID(roomId)，第三方通道推送（试点）' AFTER webhook_url"),
    ("med_medical_records", "ai_conclusion", "ALTER TABLE med_medical_records ADD COLUMN ai_conclusion JSON NULL COMMENT '归档的 AI 分析结论快照 {summary,attention,evidence}' AFTER health_education"),
    ("med_medical_records", "ai_conclusion_at", "ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_at DATETIME NULL COMMENT '结论归档时间' AFTER ai_conclusion"),
    ("med_medical_records", "ai_conclusion_by", "ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_by BIGINT NULL COMMENT '归档操作人 user_id' AFTER ai_conclusion_at"),
    ("med_medical_records", "ai_conclusion_source_id", "ALTER TABLE med_medical_records ADD COLUMN ai_conclusion_source_id BIGINT NULL COMMENT '来源 AI 分析记录 id（med_analysis_records.id）' AFTER ai_conclusion_by"),
    ("med_patients", "birth_date", "ALTER TABLE med_patients ADD COLUMN birth_date DATE NULL COMMENT '出生日期' AFTER gender"),
    ("med_patients", "allergy_history", "ALTER TABLE med_patients ADD COLUMN allergy_history TEXT NULL COMMENT '档案层常驻过敏史（与逐次病历的 allergy_history 区分）'"),
    ("med_patients", "past_history", "ALTER TABLE med_patients ADD COLUMN past_history TEXT NULL COMMENT '档案层常驻既往史'"),
]


def _ensure_columns(engine) -> None:
    """轻量列迁移：已有表缺列时 ALTER 补齐（SQLite/MySQL 兼容）。"""
    try:
        inspector = inspect(engine)
        existing = {
            t: {c["name"] for c in inspector.get_columns(t)} for t in inspector.get_table_names()
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Column migration skipped: %s", exc)
        return
    with engine.begin() as conn:
        for table, column, ddl in _COLUMN_MIGRATIONS:
            if table in existing and column not in existing[table]:
                try:
                    conn.execute(text(ddl))
                    logger.info("Migrated: added %s.%s", table, column)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Migration %s.%s failed: %s", table, column, exc)


def _active_hospital_id(db) -> int | None:
    """取启用状态的医院 ID（当前单医院场景，取 id 最小）。"""
    row = db.scalar(
        select(Hospital.id)
        .where(Hospital.status == "active", Hospital.deleted_at.is_(None))
        .order_by(Hospital.id)
        .limit(1)
    )
    return int(row) if row is not None else None


def sync_departments_from_dictionary(db) -> None:
    """让「临床科室」数据字典（department）成为组织科室树（med_departments）的对齐事实来源。

    数据范围过滤依赖组织科室树，而患者档案的科室来自业务字典；
    历史实现中两者是两套种子（字典用小写 code，组织树用大写 code），导致归属无法打通。
    本函数幂等对齐：遍历启用字典项，组织科室里存在大小写不敏感同名科室则统一其
    code/名称/类型为一级临床科室并启用；不存在则新建一级临床科室。
    每次启动调用一次，耗时与科室数量线性，安全。
    """
    hospital_id = _active_hospital_id(db)
    if hospital_id is None:
        return

    items = db.scalars(
        select(DictionaryItem)
        .join(Dictionary, Dictionary.id == DictionaryItem.dictionary_id)
        .where(
            Dictionary.hospital_id == hospital_id,
            Dictionary.dict_code == "department",
            Dictionary.status == "active",
            Dictionary.deleted_at.is_(None),
            DictionaryItem.status == "active",
        )
        .order_by(DictionaryItem.sort_order, DictionaryItem.id)
    ).all()
    if not items:
        return

    depts = list(
        db.scalars(
            select(Department).where(
                Department.hospital_id == hospital_id,
                Department.deleted_at.is_(None),
            )
        )
    )
    by_code_lower = {dept.department_code.strip().lower(): dept for dept in depts}
    max_sort = max((dept.sort_order or 0 for dept in depts), default=0)
    changed = False

    for item in items:
        code = (item.item_code or "").strip()
        label = (item.item_label or "").strip()
        if not code:
            continue
        dept = by_code_lower.get(code.lower())
        if dept is None:
            max_sort += 10
            dept = Department(
                hospital_id=hospital_id,
                department_code=code,
                department_name=label or code,
                department_type="clinical",
                tree_level=1,
                sort_order=max_sort,
                status="active",
            )
            db.add(dept)
            db.flush()  # 生成 id 以填充 tree_path
            dept.tree_path = f"/{dept.id}/"
            by_code_lower[code.lower()] = dept
            changed = True
            continue

        needs_update = (
            dept.department_code != code
            or dept.department_name != (label or code)
            or dept.department_type != "clinical"
            or dept.tree_level != 1
            or dept.status != "active"
            or dept.deleted_at is not None
        )
        if needs_update:
            dept.department_code = code
            dept.department_name = label or code
            dept.department_type = "clinical"
            dept.tree_level = 1
            dept.status = "active"
            dept.deleted_at = None
            if not dept.tree_path:
                dept.tree_path = f"/{dept.id}/"
            changed = True

    if changed:
        db.commit()
        logger.info("Department dictionary sync applied")


def backfill_patient_departments(db) -> None:
    """为缺失组织科室归属的患者，按 dept（业务字典 code）回填 department_id。

    幂等：只处理 department_id IS NULL 且 dept 非空的患者。
    """
    hospital_id = _active_hospital_id(db)
    if hospital_id is None:
        return

    patients = db.scalars(
        select(Patient).where(
            Patient.hospital_id == hospital_id,
            Patient.deleted_at.is_(None),
            Patient.department_id.is_(None),
            Patient.dept != "",
        )
    ).all()
    if not patients:
        return

    rows = db.execute(
        select(Department.id, Department.department_code).where(
            Department.hospital_id == hospital_id,
            Department.status == "active",
            Department.deleted_at.is_(None),
        )
    ).all()
    by_code = {str(code).strip().lower(): int(dept_id) for dept_id, code in rows}

    changed = False
    for patient in patients:
        dept_id = by_code.get(str(patient.dept or "").strip().lower())
        if dept_id is not None:
            patient.department_id = dept_id
            changed = True
    if changed:
        db.commit()
        logger.info("Patient department backfill applied")


def _ensure_admin_ready(db) -> None:
    """若 admin 仍为种子占位状态（占位密码 + 未启用），则激活并设置默认密码。

    只处理占位密码（以 ! 开头）且状态为 disabled 的账号，
    已手动配置过的管理员不会被覆盖。
    """
    admin = db.scalar(select(RbacUser).where(RbacUser.username == "admin").limit(1))
    if admin is None:
        return
    if admin.status != "disabled" or not admin.password_hash.startswith("!"):
        return

    admin.password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
    admin.status = "active"
    admin.must_change_password = True
    db.commit()
    logger.info(
        "Admin account '%s' activated with default password (must change on next login)",
        admin.username,
    )
