"""AI 供应商配置管理路由。

- 读取（列表 / 连接投影）：所有登录用户可见，永不返回明文凭据；
- 写操作（增删改 / 测速 / 拉模型 / 激活）：仅医院管理员，写审计日志。
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_hospital_admin
from app.exceptions import ConflictError, NotFoundError, UpstreamError
from app.models import AiProviderConfig as AiProviderConfigRow
from app.models import RbacUser
from app.schemas.ai import (
    AIConnection,
    AIProviderCreate,
    AIProviderItem,
    AIProviderProbeResult,
    AIProviderUpdate,
    ActiveAIProviderResponse,
    ActiveAIProviderUpdate,
)
from app.clients import ai_crypto
from app.clients.ai_connections import list_ai_connections
from app.clients.ai_probe import probe_provider
from app.clients.ai_provider import set_active_provider
from app.services import audit_service

router = APIRouter(tags=["ai"])

_AUDIT_MODULE = "ai_provider"


def _get_row(db: Session, hospital_id: int, provider: str) -> AiProviderConfigRow:
    """按医院 + 编码取启用行；不存在抛 404。"""
    row = db.scalar(
        select(AiProviderConfigRow).where(
            AiProviderConfigRow.hospital_id == hospital_id,
            AiProviderConfigRow.provider == provider,
        )
    )
    if row is None:
        raise NotFoundError(f"AI 供应商 {provider!r} 不存在")
    return row


def _to_item(row: AiProviderConfigRow) -> AIProviderItem:
    return AIProviderItem(
        id=row.id,
        provider=row.provider,
        display_name=row.display_name,
        protocol=row.protocol,  # type: ignore[arg-type]
        base_url=row.base_url,
        default_model=row.default_model,
        cached_models=list(row.cached_models or []),
        is_active=bool(row.is_active),
        status=row.status,
        sort_order=row.sort_order,
        has_api_key=bool(row.api_key_cipher),
        api_key_last4=row.api_key_last4,
    )


def _apply_key(row: AiProviderConfigRow, api_key: str) -> None:
    """加密并写入 API Key；空串表示清除凭据。"""
    cipher = ai_crypto.encrypt_api_key(api_key)
    row.api_key_cipher = cipher or None
    row.api_key_last4 = api_key[-4:] if len(api_key) >= 4 else None


# ---------- 读取 ----------


@router.get("/ai/connections", response_model=list[AIConnection])
async def get_ai_connections(_current_user: RbacUser = Depends(get_current_user)) -> list[AIConnection]:
    """返回服务端已注册的模型路由；凭据永不返回。"""
    return list_ai_connections(settings)


@router.get("/ai/providers", response_model=list[AIProviderItem])
async def list_providers(
    current_user: RbacUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[AIProviderItem]:
    """当前医院的 AI 供应商配置列表（不含明文凭据）。"""
    rows = db.scalars(
        select(AiProviderConfigRow)
        .where(
            AiProviderConfigRow.hospital_id == current_user.hospital_id,
            AiProviderConfigRow.status == "active",
        )
        .order_by(AiProviderConfigRow.sort_order, AiProviderConfigRow.id)
    ).all()
    return [_to_item(row) for row in rows]


# ---------- 写操作（管理员） ----------


@router.post("/ai/providers", response_model=AIProviderItem, status_code=201)
async def create_provider(
    payload: AIProviderCreate,
    request: Request,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> AIProviderItem:
    """新增 AI 供应商配置。"""
    provider_code = payload.provider.strip().lower()
    exists = db.scalar(
        select(AiProviderConfigRow.id).where(
            AiProviderConfigRow.hospital_id == admin.hospital_id,
            AiProviderConfigRow.provider == provider_code,
        )
    )
    if exists is not None:
        raise ConflictError(f"供应商 {provider_code} 已存在")
    row = AiProviderConfigRow(
        hospital_id=admin.hospital_id,
        provider=provider_code,
        display_name=payload.display_name.strip(),
        protocol=payload.protocol,
        base_url=payload.base_url.strip().rstrip("/"),
        default_model=payload.default_model.strip(),
        sort_order=payload.sort_order,
        created_by=admin.username,
    )
    _apply_key(row, payload.api_key.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    audit_service.record(
        db,
        request=request,
        user=admin,
        module=_AUDIT_MODULE,
        action="create",
        resource_type="ai_provider",
        resource_id=provider_code,
        detail=f"新增 AI 供应商 {payload.display_name}",
    )
    return _to_item(row)


@router.patch("/ai/providers/{provider}", response_model=AIProviderItem)
async def update_provider(
    provider: str,
    payload: AIProviderUpdate,
    request: Request,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> AIProviderItem:
    """更新 AI 供应商配置；api_key 缺省表示保持原值。"""
    row = _get_row(db, admin.hospital_id, provider)
    if payload.display_name is not None:
        row.display_name = payload.display_name.strip()
    if payload.protocol is not None:
        row.protocol = payload.protocol
    if payload.base_url is not None:
        row.base_url = payload.base_url.strip().rstrip("/")
    if payload.default_model is not None:
        row.default_model = payload.default_model.strip()
    if payload.sort_order is not None:
        row.sort_order = payload.sort_order
    if payload.status is not None:
        if payload.status == "disabled" and row.is_active:
            raise ConflictError("当前路由供应商不可停用，请先切换其他供应商")
        row.status = payload.status
    if payload.api_key is not None:
        _apply_key(row, payload.api_key.strip())
    db.commit()
    db.refresh(row)
    audit_service.record(
        db,
        request=request,
        user=admin,
        module=_AUDIT_MODULE,
        action="update",
        resource_type="ai_provider",
        resource_id=row.provider,
        detail=f"更新 AI 供应商 {row.display_name} 配置",
    )
    return _to_item(row)


@router.delete("/ai/providers/{provider}")
async def delete_provider(
    provider: str,
    request: Request,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> dict:
    """删除 AI 供应商配置；当前路由供应商禁止删除。"""
    row = _get_row(db, admin.hospital_id, provider)
    if row.is_active:
        raise ConflictError("当前路由供应商不可删除，请先切换其他供应商")
    db.delete(row)
    db.commit()
    audit_service.record(
        db,
        request=request,
        user=admin,
        module=_AUDIT_MODULE,
        action="delete",
        resource_type="ai_provider",
        resource_id=provider,
        detail=f"删除 AI 供应商 {row.display_name}",
    )
    return {"deleted": provider}


@router.post("/ai/providers/{provider}/activate", response_model=ActiveAIProviderResponse)
async def activate_provider(
    provider: str,
    request: Request,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> ActiveAIProviderResponse:
    """将指定供应商设为当前调用路由（其余自动取消）。"""
    row = _get_row(db, admin.hospital_id, provider)
    if not row.api_key_cipher:
        raise ConflictError(f"供应商 {row.display_name} 未配置 API Key，无法设为当前路由")
    result = set_active_provider(provider, settings, hospital_id=admin.hospital_id)
    audit_service.record(
        db,
        request=request,
        user=admin,
        module=_AUDIT_MODULE,
        action="update",
        resource_type="ai_provider",
        resource_id=provider,
        detail=f"切换当前 AI 路由为 {row.display_name}",
    )
    return ActiveAIProviderResponse(active_provider=result.name)


# ---------- 探测（管理员） ----------


async def _probe_row(row: AiProviderConfigRow) -> AIProviderProbeResult:
    """解密凭据并探测；成功时把模型列表回写 cached_models。"""
    try:
        api_key = ai_crypto.decrypt_api_key(row.api_key_cipher)
    except Exception as exc:  # noqa: BLE001
        raise UpstreamError(f"API Key 解密失败（加密密钥可能已变更）：{exc}") from exc
    result = await probe_provider(row.protocol, row.base_url, api_key, row.default_model)
    return AIProviderProbeResult(provider=row.provider, **result)


@router.post("/ai/providers/{provider}/test", response_model=AIProviderProbeResult)
async def test_provider(
    provider: str,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> AIProviderProbeResult:
    """连通性测速；成功时顺带返回可用模型列表并缓存。"""
    row = _get_row(db, admin.hospital_id, provider)
    result = await _probe_row(row)
    if result.ok and result.models:
        row.cached_models = result.models
        db.commit()
    return result


@router.get("/ai/providers/{provider}/models", response_model=AIProviderProbeResult)
async def fetch_provider_models(
    provider: str,
    admin: RbacUser = Depends(require_hospital_admin),
    db: Session = Depends(get_db),
) -> AIProviderProbeResult:
    """拉取上游可用模型列表（用于默认模型候选下拉）。"""
    row = _get_row(db, admin.hospital_id, provider)
    result = await _probe_row(row)
    if result.ok and result.models:
        row.cached_models = result.models
        db.commit()
    return result


# ---------- 旧端点（保留兼容） ----------


@router.patch("/ai/active-provider", response_model=ActiveAIProviderResponse)
async def update_active_ai_provider(
    payload: ActiveAIProviderUpdate,
    _current_user: RbacUser = Depends(require_hospital_admin),
) -> ActiveAIProviderResponse:
    """切换后续请求使用的 AI 提供商并持久化。"""
    provider = set_active_provider(payload.provider, settings)
    return ActiveAIProviderResponse(active_provider=provider.name)
