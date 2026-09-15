"""患者时间线服务：病历 + AI 分析合并为统一事件流。

供两处复用：
1. `GET /api/patients/{id}/timeline` —— 患者详情页「时间线」Tab；
2. Word 报告导出（`report_service`）的数据装配。

分析记录按患者维度取全量（不限发起人）：患者档案视角下应看到全科同事对该患者的
分析；「我的分析」界面（/api/analysis/records）仍保持仅本人私有语义。
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AnalysisRecord, MedicalRecord, Patient, RbacUser

# 病历字段 → 中文标签（与 app/models/medical_record.py 及 analysis_service 保持一致）
RECORD_FIELD_LABELS: list[tuple[str, str]] = [
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

ANALYSIS_TYPE_LABELS: dict[str, str] = {
    "record": "病历结构化",
    "medication": "用药审核",
    "risk": "风险评估",
    "exam": "检查解读",
}

GENDER_LABELS: dict[str, str] = {"male": "男", "female": "女"}

_SUMMARY_MAX = 80


def time_range_conditions(column, start_date: Optional[date], end_date: Optional[date]) -> list:
    """日期区间条件（end_date 含当天，与审计查询口径一致）。"""
    conditions = []
    if start_date:
        conditions.append(column >= datetime.combine(start_date, time.min))
    if end_date:
        conditions.append(column <= datetime.combine(end_date, time.max))
    return conditions


def _clip(value: str, limit: int = _SUMMARY_MAX) -> str:
    text = (value or "").strip().replace("\n", " ")
    return text if len(text) <= limit else f"{text[:limit]}…"


def _record_summary(record: MedicalRecord) -> str:
    """病历摘要：优先主诉，缺失回退现病史。"""
    for field in ("chief_complaint", "present_illness"):
        value = (getattr(record, field, "") or "").strip()
        if value:
            return _clip(value)
    return ""


def _analysis_summary(result: dict) -> str:
    """分析摘要：取结论 summary 的首个非空条目。"""
    summary = (result or {}).get("summary") or {}
    for value in summary.values():
        if value and str(value).strip():
            return _clip(str(value))
    return ""


def record_fields(record: MedicalRecord) -> list[tuple[str, str]]:
    """病历非空字段（标签, 值）列表，供报告正文渲染。"""
    return [
        (label, str(getattr(record, field, "") or "").strip())
        for field, label in RECORD_FIELD_LABELS
        if str(getattr(record, field, "") or "").strip()
    ]


def get_timeline_events(
    db: Session,
    patient: Patient,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> list[dict]:
    """患者时间线事件（病历 + AI 分析），按时间倒序。"""
    hospital_id = patient.hospital_id
    events: list[dict] = []

    # ---------- 病历记录 ----------
    records = db.scalars(
        select(MedicalRecord)
        .where(
            MedicalRecord.hospital_id == hospital_id,
            MedicalRecord.patient_id == patient.id,
            MedicalRecord.deleted_at.is_(None),
            *time_range_conditions(MedicalRecord.created_at, start_date, end_date),
        )
        .order_by(MedicalRecord.created_at.desc())
    ).all()
    creators = _user_names(db, [r.created_by for r in records])
    for record in records:
        events.append(
            {
                "event_type": "medical_record",
                "event_id": record.id,
                "time": record.created_at,
                "title": (record.chief_complaint or "").strip() or "（无主诉）",
                "summary": _record_summary(record),
                "status": "",
                "medical_record_id": record.id,
                "analysis_type": "",
                "model": "",
                "operator": creators.get(record.created_by or 0, ""),
                "detail": None,
            }
        )

    # ---------- AI 分析记录 ----------
    rows = db.execute(
        select(AnalysisRecord, RbacUser.real_name, RbacUser.username)
        .outerjoin(RbacUser, RbacUser.id == AnalysisRecord.user_id)
        .where(
            AnalysisRecord.hospital_id == hospital_id,
            AnalysisRecord.patient_id == patient.id,
            *time_range_conditions(AnalysisRecord.created_at, start_date, end_date),
        )
        .order_by(AnalysisRecord.created_at.desc())
    ).all()
    for row, real_name, username in rows:
        result = row.result or {}
        events.append(
            {
                "event_type": "analysis",
                "event_id": row.id,
                "time": row.created_at,
                "title": f"AI 分析 · {ANALYSIS_TYPE_LABELS.get(row.analysis_type, row.analysis_type)}",
                "summary": _analysis_summary(result) or (row.error or ""),
                "status": row.status,
                "medical_record_id": row.medical_record_id,
                "analysis_type": row.analysis_type,
                "model": row.model or "",
                "operator": real_name or username or "",
                "detail": result or None,
            }
        )

    events.sort(key=lambda item: item["time"], reverse=True)
    return events


def _user_names(db: Session, user_ids: list[int]) -> dict[int, str]:
    """批量解析用户展示名（真实姓名优先，回退账号）。"""
    ids = {int(uid) for uid in user_ids if uid}
    if not ids:
        return {}
    rows = db.execute(
        select(RbacUser.id, RbacUser.real_name, RbacUser.username).where(RbacUser.id.in_(ids))
    ).all()
    return {int(uid): (real_name or username or "") for uid, real_name, username in rows}


# ---------- 分析演变（关注点等级轨迹 + 诊断结论时间线） ----------

_LEVEL_RANK = {"低": 1, "中": 2, "高": 3}
_TREND_KEEP = 8  # 单个关注点最多保留近 N 次出现


def _trend_of(points: list[dict]) -> str:
    """依据最近两次出现的等级判断趋势。"""
    if len(points) <= 1:
        return "new"
    last = _LEVEL_RANK.get(points[-1].get("level") or "", 0)
    prev = _LEVEL_RANK.get(points[-2].get("level") or "", 0)
    if last > prev:
        return "up"
    if last < prev:
        return "down"
    return "flat"


def build_analysis_evolution(db: Session, patient: Patient) -> dict:
    """聚合该患者全部 AI 分析，输出关注点轨迹与诊断演变。

    患者维度取全量（不限发起人），与时间线语义一致；
    关注点按「标题」聚合跨次分析的出现记录；诊断节点取分析
    summary 中 key 含「诊断」或「印象」的结论条目。
    """
    hospital_id = patient.hospital_id
    rows = db.scalars(
        select(AnalysisRecord)
        .where(
            AnalysisRecord.hospital_id == hospital_id,
            AnalysisRecord.patient_id == patient.id,
            AnalysisRecord.status == "done",
        )
        .order_by(AnalysisRecord.created_at.asc())
    ).all()

    analyses: list[dict] = []
    attention_map: dict[str, list[dict]] = {}
    diagnosis_timeline: list[dict] = []

    for row in rows:
        time_str = row.created_at.replace(microsecond=0).isoformat() if row.created_at else ""
        analyses.append(
            {
                "id": row.id,
                "time": time_str,
                "analysis_type": row.analysis_type,
                "model": row.model or "",
                "status": row.status,
            }
        )
        result = row.result or {}
        for item in result.get("attention") or []:
            title = (item.get("title") or "").strip()
            if not title:
                continue
            points = attention_map.setdefault(title, [])
            points.append(
                {
                    "analysis_id": row.id,
                    "time": time_str,
                    "level": item.get("level") or "",
                    "description": item.get("description") or "",
                }
            )
        for key, value in (result.get("summary") or {}).items():
            if not value or str(value).strip() == "":
                continue
            if "诊断" in key or "印象" in key:
                diagnosis_timeline.append(
                    {
                        "analysis_id": row.id,
                        "time": time_str,
                        "key": key,
                        "value": str(value).strip(),
                    }
                )

    attention_trend = []
    for title, points in attention_map.items():
        kept = points[-_TREND_KEEP:]
        attention_trend.append(
            {
                "title": title,
                "points": kept,
                "latest_level": kept[-1].get("level") or "",
                "trend": _trend_of(kept),
            }
        )
    attention_trend.sort(key=lambda item: -len(item["points"]))

    return {
        "patient_id": patient.id,
        "analyses": analyses,
        "attention_trend": attention_trend,
        "diagnosis_timeline": diagnosis_timeline,
    }
