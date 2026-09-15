"""数据字典 API：字典与字典项的维护，以及供下拉复用的选项查询。

鉴权策略：
- 查询类接口对所有登录用户开放；
- 写入/删除类接口按功能权限点 dictionary:manage 拦截（默认医院管理员拥有）；
- 所有查询按当前用户 hospital_id 隔离数据。
"""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import RbacUser
from app.schemas.dictionary import (
    DictionaryCreateRequest,
    DictionaryItemBatchRequest,
    DictionaryItemCreateRequest,
    DictionaryItemListResponse,
    DictionaryItemOut,
    DictionaryItemUpdateRequest,
    DictionaryListResponse,
    DictionaryOptionsResponse,
    DictionaryOut,
    DictionaryUpdateRequest,
    category_label,
)
from app.services import dictionary_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dictionaries", tags=["dictionary"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


def _to_out(dictionary, item_count: int = 0) -> DictionaryOut:
    out = DictionaryOut.model_validate(dictionary)
    out.item_count = item_count
    return out


@router.get("/options/{dict_code}", response_model=DictionaryOptionsResponse)
async def get_dictionary_options(
    dict_code: str,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DictionaryOptionsResponse:
    """按字典编码取启用中的选项（供其它页面下拉框复用）。"""
    dictionary, items = dictionary_service.get_options(
        db, hospital_id=_hospital_id(user), dict_code=dict_code
    )
    return DictionaryOptionsResponse(
        dict_code=dictionary.dict_code,
        dict_name=dictionary.dict_name,
        options=[{"code": i.item_code, "label": i.item_label, "value": i.item_value or i.item_code} for i in items],
    )


@router.get("", response_model=DictionaryListResponse)
async def list_dictionaries(
    keyword: str | None = Query(None, description="按字典编码或名称模糊搜索"),
    category: str | None = Query(None, description="分类：clinical/lab/coding/business"),
    status: str | None = Query(None, description="状态：active/disabled"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DictionaryListResponse:
    """字典列表（分页 + 筛选），带每项字典的字典项数量。"""
    rows, total, counts = dictionary_service.list_dictionaries(
        db,
        hospital_id=_hospital_id(user),
        keyword=keyword,
        category=category,
        status=status,
        page=page,
        page_size=page_size,
    )
    return DictionaryListResponse(
        items=[_to_out(row, counts.get(row.id, 0)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=DictionaryOut, status_code=201)
async def create_dictionary(
    payload: DictionaryCreateRequest,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> DictionaryOut:
    """新建字典（需 dictionary:manage）。"""
    dictionary = dictionary_service.create_dictionary(
        db,
        hospital_id=_hospital_id(user),
        payload=payload,
        operator=user.username,
    )
    return _to_out(dictionary)


@router.patch("/{dict_id}", response_model=DictionaryOut)
async def update_dictionary(
    dict_id: int,
    payload: DictionaryUpdateRequest,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> DictionaryOut:
    """更新字典（需 dictionary:manage）。内置字典可改名称与状态，但不可删除。"""
    dictionary = dictionary_service.update_dictionary(
        db, hospital_id=_hospital_id(user), dict_id=dict_id, payload=payload
    )
    return _to_out(dictionary)


@router.delete("/{dict_id}", response_model=dict)
async def delete_dictionary(
    dict_id: int,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> dict:
    """删除字典（软删，需医院管理员）。内置字典或仍有字典项时拒绝。"""
    dictionary_service.delete_dictionary(db, hospital_id=_hospital_id(user), dict_id=dict_id)
    return {"ok": True}


@router.get("/{dict_id}/items", response_model=DictionaryItemListResponse)
async def list_dictionary_items(
    dict_id: int,
    keyword: str | None = Query(None, description="按项编码或显示名模糊搜索"),
    status: str | None = Query(None, description="状态：active/disabled"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DictionaryItemListResponse:
    """字典项列表（分页 + 筛选）。"""
    rows, total = dictionary_service.list_items(
        db,
        hospital_id=_hospital_id(user),
        dict_id=dict_id,
        keyword=keyword,
        status=status,
        page=page,
        page_size=page_size,
    )
    return DictionaryItemListResponse(
        items=[DictionaryItemOut.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{dict_id}/items", response_model=DictionaryItemOut, status_code=201)
async def create_dictionary_item(
    dict_id: int,
    payload: DictionaryItemCreateRequest,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> DictionaryItemOut:
    """新增字典项（需 dictionary:manage）。"""
    item = dictionary_service.create_item(
        db, hospital_id=_hospital_id(user), dict_id=dict_id, payload=payload
    )
    return DictionaryItemOut.model_validate(item)


@router.post("/{dict_id}/items/batch", response_model=dict)
async def batch_create_dictionary_items(
    dict_id: int,
    payload: DictionaryItemBatchRequest,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> dict:
    """批量导入字典项（需 dictionary:manage）。

    每行 `编码,显示名[,值]`，支持逗号/分号/换行分隔；与已有编码重复的行会跳过。
    """
    created = dictionary_service.batch_create_items(
        db, hospital_id=_hospital_id(user), dict_id=dict_id, payload=payload
    )
    return {"ok": True, "created": created}


@router.patch("/items/{item_id}", response_model=DictionaryItemOut)
async def update_dictionary_item(
    item_id: int,
    payload: DictionaryItemUpdateRequest,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> DictionaryItemOut:
    """更新字典项（需 dictionary:manage）。"""
    item = dictionary_service.update_item(
        db, hospital_id=_hospital_id(user), item_id=item_id, payload=payload
    )
    return DictionaryItemOut.model_validate(item)


@router.delete("/items/{item_id}", response_model=dict)
async def delete_dictionary_item(
    item_id: int,
    user: RbacUser = Depends(require_permission("dictionary:manage")),
    db: Session = Depends(get_db),
) -> dict:
    """删除字典项（需 dictionary:manage）。"""
    dictionary_service.delete_item(db, hospital_id=_hospital_id(user), item_id=item_id)
    return {"ok": True}


@router.get("/categories", response_model=list[dict])
async def list_categories(
    user: RbacUser = Depends(get_current_user),
) -> list[dict]:
    """字典分类枚举（供前端筛选器渲染，避免前端硬编码标签）。"""
    return [{"value": key, "label": category_label(key)} for key in ("clinical", "lab", "coding", "business")]
