"""患者档案接口。

鉴权与数据范围：
- 读（列表 / 详情 / 时间线 / 报告导出）：登录即可，按当前用户角色 data_scope 过滤患者
  （self / department / department_tree / hospital，合成规则见 scope_service）；
  越权资源按 404 处理，避免暴露患者存在性。
- 新建 / 编辑 / 导出报告：按功能权限点 patient:create / update / export 拦截，
  且在数据范围内可操作；患者组织科室归属（department_id）由所选的业务科室
  code 自动解析，前端无需感知。
- 删除整份患者档案：需 patient:delete（默认仅医院管理员拥有，涉及企微群绑定与历史追溯）。
患者编号由后端自动生成（P-YYYYMMDD-序号），不支持手填。

报告导出：GET /{id}/report 生成 Word（.docx），内容为患者基本信息 + 病历 + AI 分析，
支持 start_date / end_date 时间范围过滤，导出动作写入审计（patient/export）。
"""
import io
import logging
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.exceptions import NotFoundError
from app.models import Patient, RbacUser, WxGroup, WxGroupPatient
from app.schemas.patient import (
    AnalysisEvolutionResponse,
    PatientCreateIn,
    PatientDetailOut,
    PatientGroupOut,
    PatientListResponse,
    PatientOut,
    PatientTimelineEvent,
    PatientTimelineResponse,
    PatientUpdateIn,
)
from app.services import audit_service, report_service, scope_service, timeline_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patients", tags=["patients"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


def _calc_bmi(height: float | None, weight: float | None) -> float | None:
    """BMI = 体重(kg) / 身高(m)^2，保留 1 位小数；缺任一项返回 None。"""
    if height and weight and height > 0:
        return round(weight / ((height / 100) ** 2), 1)
    return None


def _build_patient_no(patient_id: int) -> str:
    """患者编号：P-YYYYMMDD-6位序号（序号取自自增主键，天然唯一）。"""
    return f"P-{date.today().strftime('%Y%m%d')}-{patient_id:06d}"


def _get_patient_or_404(db: Session, hospital_id: int, patient_id: int) -> Patient:
    patient = db.scalar(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.hospital_id == hospital_id,
            Patient.deleted_at.is_(None),
        )
    )
    if patient is None:
        raise NotFoundError("患者档案不存在")
    return patient


def _get_visible_patient_or_404(db: Session, user: RbacUser, patient_id: int) -> Patient:
    """取患者并校验当前用户数据范围可见；不可见视为不存在（404，防越权探测）。"""
    patient = _get_patient_or_404(db, _hospital_id(user), patient_id)
    if not scope_service.can_access_patient(db, user, patient):
        raise NotFoundError("患者档案不存在")
    return patient


@router.get("", response_model=PatientListResponse, summary="患者列表（分页 + 关键词/科室/状态筛选）")
def list_patients(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str = Query("", max_length=64, description="姓名 / 手机号 / 主诊断模糊搜索"),
    dept: str = Query("", description="科室（字典 department 的 item code）"),
    status: str = Query("", description="状态（字典 patient_status 的 item code）"),
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 数据范围过滤：hospital 隔离 + self/科室范围（见 scope_service.apply_patient_data_scope）
    stmt = scope_service.apply_patient_data_scope(select(Patient), db, current_user)
    stmt = stmt.where(Patient.deleted_at.is_(None))

    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(or_(Patient.name.like(like), Patient.phone.like(like), Patient.primary_diag.like(like)))
    if dept:
        stmt = stmt.where(Patient.dept == dept)
    if status:
        stmt = stmt.where(Patient.status == status)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Patient.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    return PatientListResponse(items=[PatientOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=PatientOut, summary="新增患者档案（登录用户）")
def create_patient(
    payload: PatientCreateIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("patient:create")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = Patient(
        hospital_id=hospital_id,
        department_id=scope_service.department_id_for_code(db, hospital_id, payload.dept),
        patient_no="",
        name=payload.name,
        gender=payload.gender,
        age=payload.age,
        birth_date=payload.birth_date,
        height=payload.height,
        weight=payload.weight,
        bmi=_calc_bmi(payload.height, payload.weight),
        waistline=payload.waistline,
        phone=payload.phone or "",
        primary_diag=payload.primary_diag,
        dept=payload.dept,
        status=payload.status,
        allergy_history=payload.allergy_history,
        past_history=payload.past_history,
        created_by=current_user.id,
    )
    db.add(patient)
    db.flush()  # 拿到自增主键
    patient.patient_no = _build_patient_no(patient.id)
    db.commit()
    db.refresh(patient)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="patient",
        action="create",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=f"新建患者档案 {patient.patient_no}",
    )
    return patient


@router.get("/{patient_id}", response_model=PatientDetailOut, summary="患者详情（含绑定企微群）")
def get_patient(
    patient_id: int,
    request: Request,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="patient",
        action="view",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=f"查看患者档案 {patient.patient_no} 详情",
    )

    binds = db.scalars(
        select(WxGroupPatient).where(
            WxGroupPatient.hospital_id == hospital_id,
            WxGroupPatient.patient_id == str(patient.id),
        )
    ).all()
    groups: list[PatientGroupOut] = []
    if binds:
        group_map = {
            g.id: g
            for g in db.scalars(
                select(WxGroup).where(WxGroup.id.in_([b.group_id for b in binds]), WxGroup.deleted_at.is_(None))
            ).all()
        }
        for b in binds:
            g = group_map.get(b.group_id)
            if g is None:
                continue
            groups.append(
                PatientGroupOut(
                    group_id=g.id,
                    chat_id=g.chat_id,
                    name=g.name or "未命名群",
                    member_count=g.member_count,
                    bind_at=b.bind_at,
                )
            )

    detail = PatientDetailOut.model_validate(patient)
    detail.groups = groups
    return detail


@router.get("/{patient_id}/timeline", response_model=PatientTimelineResponse, summary="患者时间线（病历 + AI 分析）")
def get_patient_timeline(
    patient_id: int,
    start_date: date | None = Query(None, description="开始日期（含当天，YYYY-MM-DD）"),
    end_date: date | None = Query(None, description="结束日期（含当天，YYYY-MM-DD）"),
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """患者档案视角的合并事件流（病历创建 + AI 分析），按时间倒序。

    分析记录取该患者在可见范围内的全部记录（不限发起人），便于医生看到全科的分析产出。
    """
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    events = timeline_service.get_timeline_events(db, patient, start_date, end_date)
    return PatientTimelineResponse(
        items=[PatientTimelineEvent(**event) for event in events],
        total=len(events),
    )


@router.get(
    "/{patient_id}/analysis-evolution",
    response_model=AnalysisEvolutionResponse,
    summary="患者分析演变（关注点轨迹 + 诊断结论时间线）",
)
def get_patient_analysis_evolution(
    patient_id: int,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """聚合该患者全部已完成 AI 分析：
    - attention_trend：同一关注点在各次分析中的等级轨迹与趋势（up/down/flat/new）；
    - diagnosis_timeline：summary 中诊断类结论随分析时间的演变。
    患者维度取全量（不限发起人），按分析时间升序。
    """
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    return AnalysisEvolutionResponse(**timeline_service.build_analysis_evolution(db, patient))


_REPORT_MEDIA = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


@router.get("/{patient_id}/report", summary="导出患者诊疗分析报告（Word / PDF）")
def export_patient_report(
    patient_id: int,
    format: str = Query("docx", pattern="^(docx|pdf)$", description="导出格式：docx（可编辑）/ pdf（便于打印归档）"),
    start_date: date | None = Query(None, description="开始日期（含当天，YYYY-MM-DD）"),
    end_date: date | None = Query(None, description="结束日期（含当天，YYYY-MM-DD）"),
    request: Request = None,
    current_user: RbacUser = Depends(require_permission("patient:export")),
    db: Session = Depends(get_db),
):
    """生成报告：患者基本信息 + 病历记录 + AI 分析（结论/关注点/循证依据）。

    format=docx 走 python-docx（可编辑再打印）；format=pdf 走 reportlab（版式固定）。
    导出动作写入审计（module=patient / action=export）。
    """
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    bundle = report_service.build_bundle(db, patient, current_user, start_date, end_date)
    if format == "pdf":
        content = report_service.render_pdf(bundle)
    else:
        content = report_service.render_docx(bundle)
    filename = report_service.build_filename(bundle, ext=format)

    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="patient",
        action="export",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=(
            f"导出患者 {patient.patient_no} 诊疗分析报告（{'PDF' if format == 'pdf' else 'Word'}，"
            f"范围 {bundle['range_label']}，病历 {len(bundle['records'])} 份 / "
            f"分析 {len(bundle['analyses'])} 次）"
        ),
    )
    return StreamingResponse(
        io.BytesIO(content),
        media_type=_REPORT_MEDIA[format],
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.patch("/{patient_id}", response_model=PatientOut, summary="更新患者档案（数据范围内）")
def update_patient(
    patient_id: int,
    payload: PatientUpdateIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("patient:update")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)

    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in updates.items():
        setattr(patient, field, value)
    # 身高或体重变化时重新计算 BMI
    if "height" in updates or "weight" in updates:
        patient.bmi = _calc_bmi(patient.height, patient.weight)
    # 科室变更后同步刷新组织科室归属（数据范围过滤依据）
    if "dept" in updates:
        patient.department_id = scope_service.department_id_for_code(db, hospital_id, patient.dept)
    db.commit()
    db.refresh(patient)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="patient",
        action="update",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=f"更新患者档案 {patient.patient_no}",
    )
    return patient


@router.delete("/{patient_id}", summary="删除患者档案（需 patient:delete 权限，软删除）")
def delete_patient(
    patient_id: int,
    request: Request,
    current_user: RbacUser = Depends(require_permission("patient:delete")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    from datetime import datetime

    patient.deleted_at = datetime.now()
    db.commit()
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="patient",
        action="delete",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=f"删除患者档案 {patient.patient_no}（软删除）",
    )
    return {"ok": True}
