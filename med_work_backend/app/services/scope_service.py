"""数据范围（Data Scope）服务：把角色 data_scope 语义落到实际查询过滤与单条可见性校验。

背景：med_roles.data_scope 此前只存角色/随登录返回，业务查询一律为 hospital_id 级
隔离，范围从未真正生效。本模块是所有受管资源的统一入口。

范围定义（按 med_roles.data_scope 注释）：
- self             本人创建的数据（created_by == 当前用户）
- department       当前用户主科室（primary_department_id）
- department_tree  当前用户主科室及其全部子孙科室
- hospital         本医院全部数据

多角色合成规则：
- 任一启用角色为 hospital → 全院可见；
- 否则科室范围取并集（department / department_tree 都从用户主科室出发）；
- “自己创建的数据”作为兜底恒可见（self 范围语义，保证本人建档不会因未挂科室而失联）。

归属锚点：
- Patient.department_id 为患者组织科室；
- MedicalRecord / AnalysisRecord 通过 patient_id 继承患者科室归属；
  本模块提供的条件基于 Patient 维度构造，上层对病历/分析查询先 join 患者即可复用。
"""
from collections import deque
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Department, Patient, RbacUser
from app.services import auth_service

# data_scope 取值（与 models/rbac.py、schemas/role.py 保持一致）
SCOPE_HOSPITAL = "hospital"
SCOPE_DEPARTMENT_TREE = "department_tree"
SCOPE_DEPARTMENT = "department"
SCOPE_SELF = "self"

VALID_SCOPES = (SCOPE_SELF, SCOPE_DEPARTMENT, SCOPE_DEPARTMENT_TREE, SCOPE_HOSPITAL)


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


# ---------------------------------------------------------------- 组织科室解析


def department_id_for_code(db: Session, hospital_id: int, code: str | None) -> Optional[int]:
    """按科室 code（字典 department 的 item code）解析组织科室 id。

    大小写不敏感匹配（对齐组织树与字典可能的大小写差异）；未匹配返回 None。
    """
    if not code or not code.strip():
        return None
    normalized = code.strip().lower()
    rows = db.execute(
        select(Department.id, Department.department_code).where(
            Department.hospital_id == hospital_id,
            Department.status == "active",
            Department.deleted_at.is_(None),
        )
    ).all()
    for dept_id, code_value in rows:
        if code_value and str(code_value).strip().lower() == normalized:
            return int(dept_id)
    return None


def department_subtree_ids(db: Session, hospital_id: int, root_id: int) -> set[int]:
    """返回 root_id 自身及全部子孙科室 id（按 med_departments.parent_id 广度遍历）。"""
    rows = db.execute(
        select(Department.id, Department.parent_id).where(
            Department.hospital_id == hospital_id,
            Department.deleted_at.is_(None),
        )
    ).all()
    children: dict[Optional[int], list[int]] = {}
    for dept_id, parent_id in rows:
        children.setdefault(parent_id, []).append(int(dept_id))

    result: set[int] = set()
    queue = deque([root_id])
    while queue:
        node = queue.popleft()
        if node in result:
            continue
        result.add(node)
        queue.extend(children.get(node, []))
    return result


# ---------------------------------------------------------------- 范围合成


def resolve_data_scope(
    db: Session, user: RbacUser, roles: list | None = None
) -> tuple[str, set[int]]:
    """解析用户生效的数据范围。

    返回 (mode, department_ids)：
    - mode == hospital：可访问全院患者，department_ids 为空集；
    - mode == scoped：department_ids 为允许访问的组织科室集合（可能为空，
      为空等价于仅 self——只能访问本人创建的数据）。
    默认按用户启用的角色合成（走角色缓存）；调用方也可显式传入 roles 复用既有查询。
    """
    if roles is None:
        roles = auth_service.get_user_roles(db, user)
    scopes = {role.data_scope for role in roles if role.data_scope in VALID_SCOPES}

    if SCOPE_HOSPITAL in scopes:
        return SCOPE_HOSPITAL, set()

    department_ids: set[int] = set()
    user_dept = user.primary_department_id
    if user_dept is not None and (SCOPE_DEPARTMENT in scopes or SCOPE_DEPARTMENT_TREE in scopes):
        if SCOPE_DEPARTMENT_TREE in scopes:
            department_ids.update(department_subtree_ids(db, _hospital_id(user), user_dept))
        else:
            department_ids.add(int(user_dept))

    # 无科室范围时退化为仅本人数据（self），由过滤条件中的 created_by 兜底
    return ("scoped", department_ids) if department_ids else ("scoped", set())


def apply_patient_data_scope(stmt, db: Session, user: RbacUser, roles: list | None = None):
    """给患者查询 statement 追加数据范围过滤（含 hospital_id 租户隔离）。"""
    hospital_id = _hospital_id(user)
    mode, department_ids = resolve_data_scope(db, user, roles=roles)

    stmt = stmt.where(Patient.hospital_id == hospital_id)
    if mode == SCOPE_HOSPITAL:
        return stmt

    # scoped / self：本人创建恒可见；有科室集时追加科室范围
    condition = Patient.created_by == user.id
    if department_ids:
        condition = or_(condition, Patient.department_id.in_(department_ids))
    return stmt.where(condition)


def can_access_patient(db: Session, user: RbacUser, patient: Patient, roles: list | None = None) -> bool:
    """单条患者可见性校验（详情 / 编辑等以 id 直接定位的场景）。"""
    if patient is None:
        return False
    if patient.hospital_id != _hospital_id(user):
        return False
    mode, department_ids = resolve_data_scope(db, user, roles=roles)
    if mode == SCOPE_HOSPITAL:
        return True
    if patient.created_by is not None and patient.created_by == user.id:
        return True
    return patient.department_id is not None and int(patient.department_id) in department_ids
