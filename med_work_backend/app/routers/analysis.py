"""病历分析记录接口。

鉴权：
- 读（我的记录 / 统计 / 趋势 / 详情）登录即可，仅返回本人数据；
- 发起 / 重试 / 删除按功能权限点 analysis:create / retry / delete 拦截。
"""

import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import RbacUser
from app.schemas.analysis import (
    AnalysisRecordCreateIn,
    AnalysisRecordItem,
    AnalysisRecordListResponse,
    AnalysisStatsResponse,
    AnalysisTrendResponse,
)
from app.services import analysis_service, audit_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("/record", response_model=AnalysisRecordItem, summary="创建病历分析（持久化）")
async def create_analysis(
    payload: AnalysisRecordCreateIn,
    request: Request,
    current_user: RbacUser = Depends(require_permission("analysis:create")),
    db: Session = Depends(get_db),
) -> AnalysisRecordItem:
    """选择患者 + 病历 + 分析类型，执行 AI 分析并保存历史记录。"""
    row = await analysis_service.run_analysis(db, current_user, payload)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="analysis",
        action="create",
        resource_type="analysis_record",
        resource_id=str(row.id),
        detail=f"发起 AI 病历分析（类型 {payload.analysis_type}，患者档案 #{payload.patient_id}）",
    )
    return AnalysisRecordItem(
        id=row.id,
        patient_id=row.patient_id,
        patient_name="",
        medical_record_id=row.medical_record_id,
        analysis_type=row.analysis_type,
        model=row.model,
        status=row.status,
        result=row.result,
        error=row.error,
        created_at=row.created_at,
    )


@router.get("/records/stats", response_model=AnalysisStatsResponse, summary="分析任务统计")
def get_analysis_stats(
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisStatsResponse:
    """当前用户的分析任务统计（总数 / 成功 / 失败 / 今日新增）。"""
    stats = analysis_service.record_stats(db, current_user)
    return AnalysisStatsResponse(**stats)


@router.get("/records/trend", response_model=AnalysisTrendResponse, summary="分析任务趋势（近 N 天按日统计）")
def get_analysis_trend(
    days: int = Query(default=14, ge=1, le=90),
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisTrendResponse:
    """当前用户近 N 天每日分析任务数，用于工作台趋势图。"""
    items = analysis_service.record_trend(db, current_user, days)
    return AnalysisTrendResponse(days=len(items), items=items)


@router.get("/records", response_model=AnalysisRecordListResponse, summary="历史分析记录（分页）")
def list_analysis_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None, description="状态过滤：done / failed"),
    analysis_type: str | None = Query(default=None, description="分析类型过滤：record / medication / risk / exam"),
    keyword: str | None = Query(default=None, description="患者姓名 / 编号关键词"),
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisRecordListResponse:
    rows, total = analysis_service.list_records(
        db, current_user, page, page_size, status=status, analysis_type=analysis_type, keyword=keyword
    )
    return AnalysisRecordListResponse(
        items=[
            AnalysisRecordItem(
                id=r.id,
                patient_id=r.patient_id,
                patient_name=name,
                medical_record_id=r.medical_record_id,
                analysis_type=r.analysis_type,
                model=r.model,
                status=r.status,
                result=r.result,
                error=r.error,
                created_at=r.created_at,
            )
            for r, name in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/records/{record_id}/retry", response_model=AnalysisRecordItem, summary="重试失败的分析记录")
async def retry_analysis_record(
    record_id: int,
    request: Request,
    current_user: RbacUser = Depends(require_permission("analysis:retry")),
    db: Session = Depends(get_db),
) -> AnalysisRecordItem:
    """对失败记录用原参数重跑并回写原记录（状态/结果），结果再次失败则更新错误。"""
    row = await analysis_service.retry_record(db, current_user, record_id)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="analysis",
        action="retry",
        resource_type="analysis_record",
        resource_id=str(row.id),
        detail=f"重试 AI 病历分析（类型 {row.analysis_type}，患者档案 #{row.patient_id}）",
    )
    return AnalysisRecordItem(
        id=row.id,
        patient_id=row.patient_id,
        patient_name="",
        medical_record_id=row.medical_record_id,
        analysis_type=row.analysis_type,
        model=row.model,
        status=row.status,
        result=row.result,
        error=row.error,
        created_at=row.created_at,
    )


@router.delete("/records/{record_id}", response_model=dict, summary="删除分析记录")
def delete_analysis_record(
    record_id: int,
    request: Request,
    current_user: RbacUser = Depends(require_permission("analysis:delete")),
    db: Session = Depends(get_db),
) -> dict:
    """删除当前用户的一条分析记录（物理删除，不可恢复）。"""
    analysis_service.delete_record(db, current_user, record_id)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="analysis",
        action="delete",
        resource_type="analysis_record",
        resource_id=str(record_id),
        detail=f"删除分析记录 #{record_id}",
    )
    return {"ok": True}


@router.get("/records/{record_id}", response_model=AnalysisRecordItem, summary="分析记录详情")
def get_analysis_record(
    record_id: int,
    request: Request,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisRecordItem:
    row, name = analysis_service.get_record(db, current_user, record_id)
    audit_service.record(
        db,
        request=request,
        user=current_user,
        module="analysis",
        action="view",
        resource_type="analysis_record",
        resource_id=str(record_id),
        detail=f"查看分析记录 #{record_id}（患者 {name or '-'}）",
    )
    return AnalysisRecordItem(
        id=row.id,
        patient_id=row.patient_id,
        patient_name=name,
        medical_record_id=row.medical_record_id,
        analysis_type=row.analysis_type,
        model=row.model,
        status=row.status,
        result=row.result,
        error=row.error,
        created_at=row.created_at,
    )
