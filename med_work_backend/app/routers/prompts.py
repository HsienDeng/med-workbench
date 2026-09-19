"""提示词模板 CRUD 路由：预设全局共享，所有人可编辑；个人模板按用户隔离。"""

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.exceptions import AppError, NotFoundError
from app.models import PromptTemplate, RbacUser
from app.schemas.prompt import PromptCreate, PromptOut, PromptUpdate

router = APIRouter(tags=["prompts"])


def _editable_prompt(db: Session, prompt_id: int, user: RbacUser) -> PromptTemplate:
    """取当前用户可编辑的模板（预设 + 本人自建），不存在/无权时抛 404。"""
    row = db.get(PromptTemplate, prompt_id)
    if row is None or row.deleted_at is not None or not (row.is_preset or row.user_id == user.id):
        raise NotFoundError("提示词不存在")
    return row


@router.get("/prompts", response_model=list[PromptOut])
async def list_prompts(
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PromptOut]:
    """模板列表：系统预设 + 本人自建（预设在前）。"""
    rows = db.scalars(
        select(PromptTemplate)
        .where(
            PromptTemplate.deleted_at.is_(None),
            or_(PromptTemplate.is_preset, PromptTemplate.user_id == user.id),
        )
        .order_by(PromptTemplate.is_preset.desc(), PromptTemplate.sort_order, PromptTemplate.id)
    ).all()
    return [
        PromptOut(
            id=r.id,
            name=r.name,
            description=r.description,
            content=r.content,
            is_preset=r.is_preset,
            sort_order=r.sort_order,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/prompts", response_model=PromptOut)
async def create_prompt(
    payload: PromptCreate,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PromptOut:
    """新建个人模板。"""
    now = func.now()
    row = PromptTemplate(
        hospital_id=user.hospital_id or 1,
        user_id=user.id,
        is_preset=False,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        content=payload.content.strip(),
        sort_order=0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return PromptOut(
        id=row.id,
        name=row.name,
        description=row.description,
        content=row.content,
        is_preset=False,
        sort_order=row.sort_order,
        updated_at=row.updated_at,
    )


@router.put("/prompts/{prompt_id}", response_model=PromptOut)
async def update_prompt(
    prompt_id: int,
    payload: PromptUpdate,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PromptOut:
    """更新模板（预设为全院共享，修改对所有用户生效）。"""
    row = _editable_prompt(db, prompt_id, user)
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description.strip() or None
    if payload.content is not None:
        row.content = payload.content.strip()
    row.updated_at = func.now()
    db.commit()
    db.refresh(row)
    return PromptOut(
        id=row.id,
        name=row.name,
        description=row.description,
        content=row.content,
        is_preset=row.is_preset,
        sort_order=row.sort_order,
        updated_at=row.updated_at,
    )


@router.delete("/prompts/{prompt_id}", response_model=dict)
async def delete_prompt(
    prompt_id: int,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """删除模板（软删；引用中的历史会话自动回退默认助手）。"""
    row = _editable_prompt(db, prompt_id, user)
    row.deleted_at = func.now()
    db.commit()
    return {"ok": True}
