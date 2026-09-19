"""病历记录接口（挂在患者详情下）。

鉴权与数据范围：
- 写操作按功能权限点拦截（medical_record:create / update / delete / parse / archive），
  读（列表 / 详情）登录即可；请求者需对 URL 中的患者拥有数据范围访问权
  （scope_service.can_access_patient），越权一律按 404 处理；
- 病历在数据范围内（self / 本科室 / 科室树）查看与维护，删除为软删除。
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clients.llm import (
    extract_pdf_text,
    extract_word_text,
    parse_record_image,
    parse_record_text,
)
from app.database import get_db
from app.deps import get_current_user, require_permission
from app.exceptions import AppError, NotFoundError, UpstreamError
from app.models import AnalysisRecord, MedicalRecord, Patient, RbacUser
from app.schemas.medical_record import (
    MedicalRecordArchiveIn,
    MedicalRecordCreateIn,
    MedicalRecordListResponse,
    MedicalRecordOut,
    MedicalRecordParseResponse,
    MedicalRecordUpdateIn,
)
from app.services import audit_service, scope_service

# 上传文件大小上限：15MB
_MAX_PARSE_BYTES = 15 * 1024 * 1024

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patients", tags=["medical-records"])


class AnalysisNotArchivable(AppError):
    """所选 AI 分析记录不可归档（不存在 / 未完成 / 不属于该患者），按 400 业务错误返回。"""

    status_code = 400
    code = "MED_ANALYSIS_NOT_ARCHIVABLE"
    message = "只能归档该患者已完成的分析"


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


def _get_visible_patient_or_404(db: Session, user: RbacUser, patient_id: int) -> Patient:
    """取患者并校验当前用户数据范围可见；不可见视为不存在（404，防越权探测）。"""
    patient = db.scalar(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.hospital_id == _hospital_id(user),
            Patient.deleted_at.is_(None),
        )
    )
    if patient is None or not scope_service.can_access_patient(db, user, patient):
        raise NotFoundError("患者档案不存在")
    return patient


def _get_record_or_404(db: Session, hospital_id: int, record_id: int) -> MedicalRecord:
    record = db.scalar(
        select(MedicalRecord).where(
            MedicalRecord.id == record_id,
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.deleted_at.is_(None),
        )
    )
    if record is None:
        raise NotFoundError("病历记录不存在")
    return record


@router.get("/{patient_id}/medical-records", response_model=MedicalRecordListResponse, summary="病历记录列表（按创建时间倒序）")
def list_medical_records(
    patient_id: int,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    _get_visible_patient_or_404(db, current_user, patient_id)
    rows = db.scalars(
        select(MedicalRecord)
        .where(
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.deleted_at.is_(None),
        )
        .order_by(MedicalRecord.created_at.desc(), MedicalRecord.id.desc())
    ).all()
    return MedicalRecordListResponse(
        items=[MedicalRecordOut.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.post("/{patient_id}/medical-records", response_model=MedicalRecordOut, summary="新建病历记录（数据范围内）")
def create_medical_record(
    patient_id: int,
    payload: MedicalRecordCreateIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("medical_record:create")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)

    record = MedicalRecord(
        hospital_id=hospital_id,
        patient_id=patient_id,
        chief_complaint=payload.chief_complaint,
        present_illness=payload.present_illness,
        past_history=payload.past_history,
        allergy_history=payload.allergy_history,
        drug_allergy_history=payload.drug_allergy_history,
        family_history=payload.family_history,
        physical_exam=payload.physical_exam,
        treatment_advice=payload.treatment_advice,
        lab_tests=payload.lab_tests,
        examinations=payload.examinations,
        treatment=payload.treatment,
        medications=payload.medications,
        supplements=payload.supplements,
        health_education=payload.health_education,
        created_by=current_user.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="create",
        resource_type="medical_record",
        resource_id=str(record.id),
        detail=f"新建病历记录（患者 {patient.patient_no}）",
    )
    return record


@router.post(
    "/{patient_id}/medical-records/parse",
    response_model=MedicalRecordParseResponse,
    summary="AI 解析病历文件（图片/PDF/Word，数据范围内）",
)
async def parse_medical_record_file(
    patient_id: int,
    request: Request,
    file: UploadFile = File(...),
    current_user: RbacUser = Depends(require_permission("medical_record:parse")),
    db: Session = Depends(get_db),
):
    """上传图片（vision 识别）、PDF 或 Word（文本提取）后调用 AI 解析为结构化病历字段。"""
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="parse",
        resource_type="patient",
        resource_id=patient.patient_no,
        detail=f"AI 解析病历文件 {file.filename or '未命名文件'}（患者 {patient.patient_no}）",
    )

    content = await file.read()
    if not content:
        raise AppError("上传文件为空", code="MED_DOC_EMPTY")
    if len(content) > _MAX_PARSE_BYTES:
        raise AppError("文件超出大小上限（15MB）", code="MED_DOC_TOO_LARGE")

    name = (file.filename or "").lower()
    mime = (file.content_type or "").lower()
    try:
        if name.endswith(".pdf") or mime == "application/pdf":
            text = extract_pdf_text(content)
            if len(text) < 10:
                raise AppError(
                    "该 PDF 未提取到文本，可能为扫描件，请截图为图片后使用图片识别",
                    code="MED_DOC_PARSE_FAILED",
                )
            fields = await parse_record_text(text)
            source = "pdf"
        elif name.endswith((".doc", ".docx")) or "word" in mime or "officedocument" in mime:
            text = extract_word_text(content)
            if len(text) < 10:
                raise AppError("Word 文档未提取到文本，请检查文件内容", code="MED_DOC_PARSE_FAILED")
            fields = await parse_record_text(text)
            source = "word"
        elif name.endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")) or mime.startswith("image/"):
            mime_type = mime if mime.startswith("image/") else "image/jpeg"
            fields = await parse_record_image(content, mime_type)
            source = "image"
        else:
            raise AppError(
                "暂不支持该文件格式，请上传图片（png/jpg/jpeg/bmp/webp）、PDF 或 Word 文档",
                code="MED_DOC_TYPE_UNSUPPORTED",
            )
    except AppError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("病历文件 AI 解析失败: patient_id=%s name=%s", patient_id, name)
        raise UpstreamError("AI 解析失败，请稍后重试或手动录入") from exc

    return MedicalRecordParseResponse(source=source, **fields)


@router.get("/{patient_id}/medical-records/{record_id}", response_model=MedicalRecordOut, summary="病历记录详情")
def get_medical_record(
    patient_id: int,
    record_id: int,
    request: Request,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    record = db.scalar(
        select(MedicalRecord).where(
            MedicalRecord.id == record_id,
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.deleted_at.is_(None),
        )
    )
    if record is None:
        raise NotFoundError("病历记录不存在")
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="view",
        resource_type="medical_record",
        resource_id=str(record.id),
        detail=f"查看病历记录 #{record.id}（患者 {patient.patient_no}）",
    )
    return record


@router.patch("/{patient_id}/medical-records/{record_id}", response_model=MedicalRecordOut, summary="更新病历记录（数据范围内）")
def update_medical_record(
    patient_id: int,
    record_id: int,
    payload: MedicalRecordUpdateIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("medical_record:update")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    record = _get_record_or_404(db, hospital_id, record_id)
    if record.patient_id != patient_id:
        raise NotFoundError("病历记录不存在")

    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in updates.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="update",
        resource_type="medical_record",
        resource_id=str(record.id),
        detail=f"更新病历记录 #{record.id}（患者 {patient.patient_no}）",
    )
    return record


@router.delete("/{patient_id}/medical-records/{record_id}", summary="删除病历记录（数据范围内，软删除）")
def delete_medical_record(
    patient_id: int,
    record_id: int,
    request: Request,
    current_user: RbacUser = Depends(require_permission("medical_record:delete")),
    db: Session = Depends(get_db),
):
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    record = _get_record_or_404(db, hospital_id, record_id)
    if record.patient_id != patient_id:
        raise NotFoundError("病历记录不存在")
    record.deleted_at = datetime.now()
    db.commit()
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="delete",
        resource_type="medical_record",
        resource_id=str(record.id),
        detail=f"删除病历记录 #{record.id}（患者 {patient.patient_no}）",
    )
    return {"ok": True}


@router.post(
    "/{patient_id}/medical-records/{record_id}/archive-analysis",
    response_model=MedicalRecordOut,
    summary="归档 AI 分析结论到病历（数据范围内）",
)
def archive_analysis_to_record(
    patient_id: int,
    record_id: int,
    payload: MedicalRecordArchiveIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("medical_record:archive")),
    db: Session = Depends(get_db),
):
    """把一条已完成 AI 分析的 result 快照写入病历 ai_conclusion 四列。

    - 患者 / 病历均须在当前用户数据范围内（越权按 404 防探测）；
    - 分析记录须存在、状态为 done、result 非空且 patient_id 与该患者一致，
      否则 400「只能归档该患者已完成的分析」（失败/他人分析不区分明细，避免泄漏）；
    - 幂等：来源分析 id 已归档（ai_conclusion_source_id == analysis_id 且归档时间非空）时
      直接返回当前状态不重复写入；否则允许覆盖为最新一次结论。
    """
    hospital_id = _hospital_id(current_user)
    patient = _get_visible_patient_or_404(db, current_user, patient_id)
    record = db.scalar(
        select(MedicalRecord).where(
            MedicalRecord.id == record_id,
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.deleted_at.is_(None),
        )
    )
    if record is None:
        raise NotFoundError("病历记录不存在")

    # 幂等：同一来源分析已归档，直接返回当前状态（不重复写、不再记审计）
    if (
        record.ai_conclusion_source_id == payload.analysis_id
        and record.ai_conclusion is not None
        and record.ai_conclusion_at is not None
    ):
        return record

    analysis = db.scalar(
        select(AnalysisRecord).where(
            AnalysisRecord.id == payload.analysis_id,
            AnalysisRecord.patient_id == patient_id,
            AnalysisRecord.hospital_id == hospital_id,
        )
    )
    if analysis is None or analysis.status != "done" or not analysis.result:
        raise AnalysisNotArchivable()

    record.ai_conclusion = analysis.result
    record.ai_conclusion_at = datetime.now()
    record.ai_conclusion_by = current_user.id
    record.ai_conclusion_source_id = analysis.id
    db.commit()
    db.refresh(record)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="medical_record",
        action="archive",
        resource_type="medical_record",
        resource_id=str(record.id),
        detail=f"归档 AI 分析记录 #{analysis.id}（患者 {patient.patient_no}）",
    )
    return record
