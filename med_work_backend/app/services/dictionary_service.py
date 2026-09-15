"""数据字典业务逻辑：字典与字典项的 CRUD，以及内置字典种子。

读取类操作对所有登录用户开放；写入类操作由路由层用权限点 dictionary:manage 守卫。
"""
import logging
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models import Dictionary, DictionaryItem
from app.schemas.dictionary import (
    DictionaryCreateRequest,
    DictionaryItemBatchRequest,
    DictionaryItemCreateRequest,
    DictionaryItemUpdateRequest,
    DictionaryUpdateRequest,
)

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 200

# 内置字典种子：仅在没有该 code 时插入，已存在的不覆盖、不删改
DICTIONARY_SEED: tuple[dict, ...] = (
    {
        "dict_code": "doc_type",
        "dict_name": "文档类型",
        "category": "business",
        "description": "知识库文档的分类，与上传/检索筛选保持一致",
        "sort_order": 10,
        "items": (
            ("guide", "临床指南"),
            ("literature", "医学文献"),
            ("drug", "药品说明书"),
            ("norm", "院内规范"),
            ("case", "疑难病例"),
            ("other", "其他"),
        ),
    },
    {
        "dict_code": "department",
        "dict_name": "临床科室",
        "category": "clinical",
        "description": "院内临床科室，用于患者档案与分析任务归属",
        "sort_order": 20,
        "items": (
            ("internal", "内科"),
            ("surgery", "外科"),
            ("pediatrics", "儿科"),
            ("obstetrics", "妇产科"),
            ("emergency", "急诊科"),
            ("cardiology", "心血管内科"),
            ("neurology", "神经内科"),
            ("orthopedics", "骨科"),
        ),
    },
    {
        "dict_code": "lab_category",
        "dict_name": "检验项目类别",
        "category": "lab",
        "description": "检验指标的分类，用于检验报告结构化解析",
        "sort_order": 30,
        "items": (
            ("blood", "血常规"),
            ("biochemistry", "生化"),
            ("immunity", "免疫"),
            ("urine", "尿常规"),
            ("coagulation", "凝血"),
            ("microbiology", "微生物"),
        ),
    },
    {
        "dict_code": "coding_system",
        "dict_name": "医学编码体系",
        "category": "coding",
        "description": "平台对接的医学标准编码体系，用于实体归一与结果回显",
        "sort_order": 40,
        "items": (
            ("icd10", "ICD-10 疾病编码"),
            ("icd9", "ICD-9-CM 手术操作"),
            ("atc", "ATC 药物分类"),
            ("loinc", "LOINC 检验项目"),
            ("snomed", "SNOMED CT"),
        ),
    },
    {
        "dict_code": "patient_status",
        "dict_name": "患者状态",
        "category": "business",
        "description": "患者在院状态枚举",
        "sort_order": 50,
        "items": (
            ("in", "在院"),
            ("out", "出院"),
            ("transfer", "转院"),
        ),
    },
    {
        "dict_code": "index_status",
        "dict_name": "索引状态",
        "category": "business",
        "description": "知识库文档的索引处理状态，与文档管理筛选保持一致",
        "sort_order": 60,
        "items": (
            ("uploaded", "未索引"),
            ("parsing", "处理中"),
            ("ready", "已索引"),
            ("failed", "索引失败"),
        ),
    },
    {
        "dict_code": "source_type",
        "dict_name": "来源分类",
        "category": "business",
        "description": "知识库文档的来源分类：本地上传 / IMA 搬运",
        "sort_order": 70,
        "items": (
            ("system", "本地上传"),
            ("ima", "IMA 搬运"),
        ),
    },
)


# ---------- 查询 ----------


def _base_query(hospital_id: int):
    return select(Dictionary).where(
        Dictionary.hospital_id == hospital_id,
        Dictionary.deleted_at.is_(None),
    )


def _item_counts(db: Session, ids: list[int]) -> dict[int, int]:
    """批量统计各字典的项数量，避免逐条 count 造成 N+1。"""
    if not ids:
        return {}
    rows = db.execute(
        select(DictionaryItem.dictionary_id, func.count(DictionaryItem.id))
        .where(DictionaryItem.dictionary_id.in_(ids))
        .group_by(DictionaryItem.dictionary_id)
    ).all()
    return {int(dict_id): int(count) for dict_id, count in rows}


def list_dictionaries(
    db: Session,
    *,
    hospital_id: int,
    keyword: str | None = None,
    category: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Dictionary], int, dict[int, int]]:
    """分页查询字典，返回 (字典列表, 总数, 各字典项数量)。"""
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    query = _base_query(hospital_id)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        query = query.where(
            Dictionary.dict_code.like(pattern) | Dictionary.dict_name.like(pattern)
        )
    if category:
        query = query.where(Dictionary.category == category)
    if status:
        query = query.where(Dictionary.status == status)

    total = db.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    ) or 0
    rows = list(
        db.scalars(
            query.order_by(Dictionary.sort_order, Dictionary.id).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return rows, total, _item_counts(db, [row.id for row in rows])


def get_dictionary(db: Session, *, hospital_id: int, dict_id: int) -> Dictionary:
    """按 ID 取字典，不存在或已删除抛 404。"""
    dictionary = db.scalar(
        _base_query(hospital_id).where(Dictionary.id == dict_id).limit(1)
    )
    if dictionary is None:
        raise NotFoundError("字典不存在")
    return dictionary


def _get_by_code(db: Session, *, hospital_id: int, dict_code: str) -> Dictionary | None:
    return db.scalar(
        _base_query(hospital_id).where(Dictionary.dict_code == dict_code).limit(1)
    )


# ---------- 字典写入 ----------


def create_dictionary(
    db: Session, *, hospital_id: int, payload: DictionaryCreateRequest, operator: str
) -> Dictionary:
    if _get_by_code(db, hospital_id=hospital_id, dict_code=payload.dict_code) is not None:
        raise ConflictError(f"字典编码 {payload.dict_code} 已存在", code="MED_DICT_CODE_EXISTS")

    dictionary = Dictionary(
        hospital_id=hospital_id,
        dict_code=payload.dict_code,
        dict_name=payload.dict_name,
        category=payload.category,
        description=payload.description,
        status=payload.status,
        builtin=False,
        sort_order=payload.sort_order,
        created_by=operator,
    )
    db.add(dictionary)
    db.commit()
    db.refresh(dictionary)
    return dictionary


def update_dictionary(
    db: Session, *, hospital_id: int, dict_id: int, payload: DictionaryUpdateRequest
) -> Dictionary:
    dictionary = get_dictionary(db, hospital_id=hospital_id, dict_id=dict_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(dictionary, field, value)
    db.commit()
    db.refresh(dictionary)
    return dictionary


def delete_dictionary(db: Session, *, hospital_id: int, dict_id: int) -> None:
    """软删除字典；内置字典禁止删除，仍有字典项的字典需先清空。"""
    dictionary = get_dictionary(db, hospital_id=hospital_id, dict_id=dict_id)
    if dictionary.builtin:
        raise ForbiddenError("内置字典不可删除", code="MED_DICT_BUILTIN_READONLY")

    item_count = db.scalar(
        select(func.count())
        .select_from(DictionaryItem)
        .where(DictionaryItem.dictionary_id == dict_id)
    ) or 0
    if item_count:
        raise ConflictError(
            f"该字典下仍有 {item_count} 个字典项，请先清空后再删除",
            code="MED_DICT_NOT_EMPTY",
        )

    dictionary.deleted_at = datetime.now()
    db.commit()


# ---------- 字典项 ----------


def list_items(
    db: Session,
    *,
    hospital_id: int,
    dict_id: int,
    keyword: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[DictionaryItem], int]:
    """分页查询字典项，返回 (列表, 总数)。"""
    get_dictionary(db, hospital_id=hospital_id, dict_id=dict_id)

    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    query = select(DictionaryItem).where(DictionaryItem.dictionary_id == dict_id)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        query = query.where(
            DictionaryItem.item_code.like(pattern) | DictionaryItem.item_label.like(pattern)
        )
    if status:
        query = query.where(DictionaryItem.status == status)

    total = db.scalar(
        select(func.count()).select_from(query.order_by(None).subquery())
    ) or 0
    rows = list(
        db.scalars(
            query.order_by(DictionaryItem.sort_order, DictionaryItem.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return rows, total


def get_item(db: Session, *, hospital_id: int, item_id: int) -> DictionaryItem:
    """按 ID 取字典项（校验其所属字典属于当前医院），不存在抛 404。"""
    item = db.scalar(
        select(DictionaryItem)
        .join(Dictionary, Dictionary.id == DictionaryItem.dictionary_id)
        .where(
            DictionaryItem.id == item_id,
            Dictionary.hospital_id == hospital_id,
            Dictionary.deleted_at.is_(None),
        )
        .limit(1)
    )
    if item is None:
        raise NotFoundError("字典项不存在")
    return item


def create_item(
    db: Session,
    *,
    hospital_id: int,
    dict_id: int,
    payload: DictionaryItemCreateRequest,
) -> DictionaryItem:
    get_dictionary(db, hospital_id=hospital_id, dict_id=dict_id)
    _assert_item_code_free(db, dict_id=dict_id, item_code=payload.item_code)

    item = DictionaryItem(
        dictionary_id=dict_id,
        item_code=payload.item_code,
        item_label=payload.item_label,
        item_value=payload.item_value or payload.item_code,
        sort_order=payload.sort_order,
        status=payload.status,
        remark=payload.remark,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _assert_item_code_free(db: Session, *, dict_id: int, item_code: str, exclude_id: int | None = None) -> None:
    query = select(DictionaryItem.id).where(
        DictionaryItem.dictionary_id == dict_id,
        DictionaryItem.item_code == item_code,
    )
    if exclude_id is not None:
        query = query.where(DictionaryItem.id != exclude_id)
    if db.scalar(query.limit(1)) is not None:
        raise ConflictError(f"项编码 {item_code} 在该字典中已存在", code="MED_DICT_ITEM_CODE_EXISTS")


def update_item(
    db: Session, *, hospital_id: int, item_id: int, payload: DictionaryItemUpdateRequest
) -> DictionaryItem:
    item = get_item(db, hospital_id=hospital_id, item_id=item_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, *, hospital_id: int, item_id: int) -> None:
    item = get_item(db, hospital_id=hospital_id, item_id=item_id)
    db.delete(item)
    db.commit()


def batch_create_items(
    db: Session,
    *,
    hospital_id: int,
    dict_id: int,
    payload: DictionaryItemBatchRequest,
) -> int:
    """批量导入字典项，返回成功导入条数。

    每行格式 `编码,显示名[,值]`；空行与 `#` 开头行跳过。
    与已有编码冲突的行整行跳过（不中断其余行）。
    """
    get_dictionary(db, hospital_id=hospital_id, dict_id=dict_id)

    existing_codes = set(
        db.scalars(
            select(DictionaryItem.item_code).where(DictionaryItem.dictionary_id == dict_id)
        )
    )
    max_sort = db.scalar(
        select(func.coalesce(func.max(DictionaryItem.sort_order), 0)).where(
            DictionaryItem.dictionary_id == dict_id
        )
    ) or 0

    created = 0
    sort = int(max_sort)
    seen: set[str] = set(existing_codes)
    for raw_line in payload.text.replace("；", ";").replace("\r", "\n").replace(";", "\n").split("\n"):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            continue
        code, label = parts[0], parts[1]
        value = parts[2] if len(parts) > 2 and parts[2] else code
        if code in seen:
            continue
        seen.add(code)
        sort += 1
        db.add(
            DictionaryItem(
                dictionary_id=dict_id,
                item_code=code,
                item_label=label,
                item_value=value,
                sort_order=sort,
                status="active",
            )
        )
        created += 1

    if created:
        db.commit()
    return created


def get_options(db: Session, *, hospital_id: int, dict_code: str) -> tuple[Dictionary, list[DictionaryItem]]:
    """按编码取启用中的字典项，供其它页面下拉复用。"""
    dictionary = _get_by_code(db, hospital_id=hospital_id, dict_code=dict_code)
    if dictionary is None:
        raise NotFoundError(f"字典 {dict_code} 不存在")
    items = list(
        db.scalars(
            select(DictionaryItem)
            .where(
                DictionaryItem.dictionary_id == dictionary.id,
                DictionaryItem.status == "active",
            )
            .order_by(DictionaryItem.sort_order, DictionaryItem.id)
        )
    )
    return dictionary, items


# ---------- 种子 ----------


def sync_dictionary_seed(db: Session, hospital_id: int = 1) -> None:
    """幂等写入内置字典：缺少的 code 才插入，已存在的一律不动。"""
    created_dicts = 0
    created_items = 0
    for seed in DICTIONARY_SEED:
        dictionary = _get_by_code(db, hospital_id=hospital_id, dict_code=seed["dict_code"])
        if dictionary is None:
            dictionary = Dictionary(
                hospital_id=hospital_id,
                dict_code=seed["dict_code"],
                dict_name=seed["dict_name"],
                category=seed["category"],
                description=seed["description"],
                status="active",
                builtin=True,
                sort_order=seed["sort_order"],
                created_by="system",
            )
            db.add(dictionary)
            db.flush()
            created_dicts += 1

        existing = set(
            db.scalars(
                select(DictionaryItem.item_code).where(DictionaryItem.dictionary_id == dictionary.id)
            )
        )
        for index, (code, label) in enumerate(seed["items"], start=1):
            if code in existing:
                continue
            db.add(
                DictionaryItem(
                    dictionary_id=dictionary.id,
                    item_code=code,
                    item_label=label,
                    item_value=code,
                    sort_order=index * 10,
                    status="active",
                )
            )
            created_items += 1

    db.commit()
    if created_dicts or created_items:
        logger.info(
            "Dictionary seed synced: +%d dictionaries, +%d items", created_dicts, created_items
        )
