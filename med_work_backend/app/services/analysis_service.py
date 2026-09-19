"""病历分析编排服务：取病历 → 拼装文本 → RAG 检索 → AI 分析 → 持久化。"""

import logging
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.clients import llm
from app.clients.ai_provider import get_active_provider
from app.config import settings
from app.exceptions import AppError, NotFoundError
from app.models import AnalysisRecord, MedicalRecord, Patient, RbacUser
from app.schemas.analysis import AnalysisRecordCreateIn
from app.services import notification_service
from app.services import rag_proxy
from app.services import scope_service

logger = logging.getLogger(__name__)

# 分析类型 → 中文名（与 timeline_service / 前端一致）
_ANALYSIS_TYPE_LABELS: dict[str, str] = {
    "record": "病历结构化",
    "medication": "用药审核",
    "risk": "风险评估",
    "exam": "检查解读",
}

# 病历字段 → 中文标签（与 app/models/medical_record.py 一致）
_FIELD_LABELS: list[tuple[str, str]] = [
    ("chief_complaint", "主诉"),
    ("present_illness", "现病史"),
    ("past_history", "既往史"),
    ("allergy_history", "过敏史"),
    ("drug_allergy_history", "药敏史"),
    ("family_history", "家族史"),
    ("physical_exam", "体格检查"),
    ("lab_tests", "检验"),
    ("examinations", "检查"),
    ("treatment", "治疗"),
    ("medications", "用药"),
    ("treatment_advice", "处理意见"),
    ("supplements", "补充内容"),
    ("health_education", "健康教育"),
]

# 知识库检索条数
_KNOWLEDGE_LIMIT = 6


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


def _analysis_type_label(analysis_type: str) -> str:
    return _ANALYSIS_TYPE_LABELS.get(analysis_type, analysis_type or "病历分析")


def build_record_text(record: MedicalRecord) -> str:
    """把病历 14 个结构化字段拼装为带标签的文本，供 AI 分析。"""
    parts = []
    for field, label in _FIELD_LABELS:
        value = getattr(record, field, "")
        if value and value.strip():
            parts.append(f"【{label}】{value.strip()}")
    return "\n".join(parts)


def _knowledge_query(record: MedicalRecord) -> str:
    """取主诉/现病史片段（≤200 字）作为知识库检索关键词。"""
    for field in ("chief_complaint", "present_illness"):
        value = (getattr(record, field, "") or "").strip()
        if value:
            return value[:200]
    return ""


async def search_knowledge(hospital_id: int, record: MedicalRecord) -> list[dict] | None:
    """检索本机构医学知识库；失败 / 未命中时返回 None，不阻塞主链路。"""
    query = _knowledge_query(record)
    if not query:
        return None
    try:
        body = await rag_proxy.search(hospital_id=hospital_id, q=query, limit=_KNOWLEDGE_LIMIT)
    except Exception as exc:  # noqa: BLE001
        logger.warning("分析知识库检索失败，降级为纯模型分析: %s", exc)
        return None
    hits = body.get("hits") or []
    if not hits:
        return None
    return [
        {
            "document_id": h.get("document_id"),
            "title": h.get("title", ""),
            "content": str(h.get("content", ""))[:500],
            "score": h.get("score", 0),
        }
        for h in hits
    ]


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


def _get_record_or_404(
    db: Session, hospital_id: int, patient_id: int, record_id: int
) -> MedicalRecord:
    record = db.scalar(
        select(MedicalRecord).where(
            MedicalRecord.id == record_id,
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.patient_id == patient_id,
            MedicalRecord.deleted_at.is_(None),
        )
    )
    if record is None:
        raise NotFoundError("病历记录不存在")
    return record


def _save_failed(db: Session, user: RbacUser, payload: AnalysisRecordCreateIn, model: str, error: str) -> AnalysisRecord:
    """AI 失败时落一条 failed 记录，便于历史可追溯；返回该记录。"""
    row = AnalysisRecord(
        hospital_id=_hospital_id(user),
        user_id=user.id,
        patient_id=payload.patient_id,
        medical_record_id=payload.medical_record_id,
        analysis_type=payload.analysis_type,
        model=model,
        status="failed",
        result=None,
        error=error[:500],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


async def run_analysis(
    db: Session, user: RbacUser, payload: AnalysisRecordCreateIn
) -> AnalysisRecord:
    """执行一次病历分析并持久化记录。

    步骤：校验患者可见性（数据范围）+ 病历归属 → 拼装 14 字段文本
    → RAG 检索（失败降级）→ AI 分析 → 写库。
    AI 失败时落 failed 记录后抛出受控异常。
    """
    hospital_id = _hospital_id(user)
    patient = _get_patient_or_404(db, hospital_id, payload.patient_id)
    # 数据范围校验：只允许对自己可见范围的患者发起分析，越权视为 404
    if not scope_service.can_access_patient(db, user, patient):
        raise NotFoundError("患者档案不存在")
    record = _get_record_or_404(db, hospital_id, payload.patient_id, payload.medical_record_id)

    text = build_record_text(record)
    if not text.strip():
        raise AppError("病历内容为空，无法分析", code="MED_DOC_EMPTY")

    provider = get_active_provider(settings)
    model = provider.model
    knowledge = await search_knowledge(hospital_id, record)

    try:
        data = await llm.analyze_record(
            text, payload.analysis_type, provider, knowledge=knowledge
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "病历分析失败: user_id=%s patient_id=%s record_id=%s type=%s",
            user.id, payload.patient_id, payload.medical_record_id, payload.analysis_type,
        )
        failed_row = _save_failed(db, user, payload, model, str(exc))
        notification_service.create(
            db,
            user=user,
            type="analysis_failed",
            title="AI 分析失败",
            content=f"{_analysis_type_label(payload.analysis_type)}失败：{(str(exc) or '')[:200]}",
            resource_type="analysis_record",
            resource_id=str(failed_row.id),
        )
        raise AppError(
            f"调用 {provider.name} 分析失败：{exc}", code="MED_AI_CALL_FAILED"
        ) from exc

    row = AnalysisRecord(
        hospital_id=hospital_id,
        user_id=user.id,
        patient_id=payload.patient_id,
        medical_record_id=payload.medical_record_id,
        analysis_type=payload.analysis_type,
        model=data.get("model", model),
        status="done",
        result=data.get("result"),
        error=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info(
        "病历分析完成: id=%s user_id=%s patient_id=%s type=%s model=%s",
        row.id, user.id, payload.patient_id, payload.analysis_type, row.model,
    )
    return row


def list_records(
    db: Session,
    user: RbacUser,
    page: int,
    page_size: int,
    status: Optional[str] = None,
    analysis_type: Optional[str] = None,
    keyword: Optional[str] = None,
) -> tuple[list[tuple[AnalysisRecord, str]], int]:
    """当前用户的历史分析记录（联查患者姓名，按时间倒序）。

    支持按状态 / 分析类型 / 患者关键词（姓名或编号）过滤。
    """
    hospital_id = _hospital_id(user)
    conditions = [
        AnalysisRecord.hospital_id == hospital_id,
        AnalysisRecord.user_id == user.id,
    ]
    if status:
        conditions.append(AnalysisRecord.status == status)
    if analysis_type:
        conditions.append(AnalysisRecord.analysis_type == analysis_type)
    if keyword and keyword.strip():
        kw = f"%{keyword.strip()}%"
        conditions.append(or_(Patient.name.like(kw), Patient.patient_no.like(kw)))

    base = (
        select(AnalysisRecord, Patient.name)
        .join(Patient, Patient.id == AnalysisRecord.patient_id)
        .where(*conditions)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        db.execute(
            base.order_by(AnalysisRecord.created_at.desc(), AnalysisRecord.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .all()
    )
    return [(r[0], r[1] or "") for r in rows], total


def record_stats(db: Session, user: RbacUser) -> dict[str, int]:
    """当前用户的分析任务统计：总数 / 成功 / 失败 / 今日新增。"""
    hospital_id = _hospital_id(user)
    today_start = datetime.combine(date.today(), time.min)
    base_where = (
        AnalysisRecord.hospital_id == hospital_id,
        AnalysisRecord.user_id == user.id,
    )

    def count_where(*conds) -> int:
        return db.scalar(
            select(func.count()).select_from(AnalysisRecord).where(*base_where, *conds)
        ) or 0

    return {
        "total": count_where(),
        "done": count_where(AnalysisRecord.status == "done"),
        "failed": count_where(AnalysisRecord.status == "failed"),
        "today": count_where(AnalysisRecord.created_at >= today_start),
    }


def record_trend(db: Session, user: RbacUser, days: int = 14) -> list[dict[str, object]]:
    """当前用户近 N 天每日分析任务数（含成功/失败），无记录的天补 0。"""
    hospital_id = _hospital_id(user)
    start_date = date.today() - timedelta(days=days - 1)
    day_col = func.date(AnalysisRecord.created_at)
    rows = db.execute(
        select(day_col.label("d"), func.count().label("c"))
        .where(
            AnalysisRecord.hospital_id == hospital_id,
            AnalysisRecord.user_id == user.id,
            AnalysisRecord.created_at >= datetime.combine(start_date, time.min),
        )
        .group_by(day_col)
        .order_by(day_col)
    ).all()
    counts: dict[date, int] = {r.d: r.c for r in rows}
    return [
        {
            "date": (start_date + timedelta(days=i)).strftime("%m-%d"),
            "count": counts.get(start_date + timedelta(days=i), 0),
        }
        for i in range(days)
    ]


def get_record(db: Session, user: RbacUser, record_id: int) -> tuple[AnalysisRecord, str]:
    """取当前用户的分析记录详情（含患者姓名），不存在/越权时抛 404。"""
    hospital_id = _hospital_id(user)
    row = db.execute(
        select(AnalysisRecord, Patient.name)
        .join(Patient, Patient.id == AnalysisRecord.patient_id)
        .where(
            AnalysisRecord.id == record_id,
            AnalysisRecord.hospital_id == hospital_id,
            AnalysisRecord.user_id == user.id,
        )
    ).first()
    if row is None:
        raise NotFoundError("分析记录不存在")
    return row[0], row[1] or ""


def delete_record(db: Session, user: RbacUser, record_id: int) -> None:
    """删除当前用户的一条分析记录（物理删除）；不存在/越权时抛 404。"""
    hospital_id = _hospital_id(user)
    row = db.scalar(
        select(AnalysisRecord).where(
            AnalysisRecord.id == record_id,
            AnalysisRecord.hospital_id == hospital_id,
            AnalysisRecord.user_id == user.id,
        )
    )
    if row is None:
        raise NotFoundError("分析记录不存在")
    db.delete(row)
    db.commit()
    logger.info("删除分析记录: id=%s user_id=%s", record_id, user.id)


async def retry_record(db: Session, user: RbacUser, record_id: int) -> AnalysisRecord:
    """重试一条失败的分析记录：校验失败状态后用原参数重跑，结果回写原记录。

    - 仅允许对 status=failed 的记录重试（done 记录无失败可重试）；
    - 重跑前再次校验患者数据范围可见（越权按 404）；
    - 成功回写 result/model/status=done/error=None；再次失败则更新 error 并抛受控异常。
    """
    hospital_id = _hospital_id(user)
    row, _ = get_record(db, user, record_id)
    if row.status != "failed":
        raise AppError("仅失败的分析任务可以重试", code="MED_RETRY_NOT_FAILED")

    patient = _get_patient_or_404(db, hospital_id, row.patient_id)
    if not scope_service.can_access_patient(db, user, patient):
        raise NotFoundError("患者档案不存在")
    record = _get_record_or_404(db, hospital_id, row.patient_id, row.medical_record_id)

    text = build_record_text(record)
    if not text.strip():
        raise AppError("病历内容为空，无法分析", code="MED_DOC_EMPTY")

    provider = get_active_provider(settings)
    model = provider.model
    knowledge = await search_knowledge(hospital_id, record)

    try:
        data = await llm.analyze_record(
            text, row.analysis_type, provider, knowledge=knowledge
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "病历分析重试失败: id=%s user_id=%s patient_id=%s record_id=%s type=%s",
            row.id, user.id, row.patient_id, row.medical_record_id, row.analysis_type,
        )
        row.status = "failed"
        row.result = None
        row.error = (str(exc) or "")[:500]
        row.model = model
        db.commit()
        notification_service.create(
            db,
            user=user,
            type="analysis_failed",
            title="AI 分析重试失败",
            content=f"{_analysis_type_label(row.analysis_type)}重试失败：{(str(exc) or '')[:200]}",
            resource_type="analysis_record",
            resource_id=str(row.id),
        )
        raise AppError(f"调用 {provider.name} 分析失败：{exc}", code="MED_AI_CALL_FAILED") from exc

    row.status = "done"
    row.result = data.get("result")
    row.error = None
    row.model = data.get("model", model)
    db.commit()
    db.refresh(row)
    logger.info("病历分析重试完成: id=%s user_id=%s type=%s model=%s", row.id, user.id, row.analysis_type, row.model)
    return row
