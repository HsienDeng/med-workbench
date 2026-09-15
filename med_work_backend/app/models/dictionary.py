"""数据字典 ORM 模型：字典（分组）+ 字典项。

用于统一维护平台的医学术语、编码体系与业务枚举，
供文档分类、患者档案、分析任务等下拉选项复用，避免枚举散落在各业务表与前端常量中。
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Dictionary(Base):
    """字典主表（一个字典即一组枚举，如「临床科室」「检验项目类别」）。"""

    __tablename__ = "med_dictionaries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    dict_code: Mapped[str] = mapped_column(String(64), nullable=False, comment="字典编码（租户内唯一，程序引用用）")
    dict_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="字典名称")
    category: Mapped[str] = mapped_column(
        String(32), nullable=False, default="business", comment="分类：clinical 临床 / lab 检验 / coding 编码体系 / business 业务"
    )
    description: Mapped[str | None] = mapped_column(String(500), comment="字典说明")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active 启用 / disabled 停用")
    builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否内置字典（内置不可删除）")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="显示顺序")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system", comment="创建人")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_dict_hospital_status", "hospital_id", "status", "deleted_at"),
        Index("ix_dict_hospital_code", "hospital_id", "dict_code"),
    )


class DictionaryItem(Base):
    """字典项（枚举值），从属于一个字典。"""

    __tablename__ = "med_dictionary_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dictionary_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("med_dictionaries.id", ondelete="CASCADE"), nullable=False, comment="所属字典ID"
    )
    item_code: Mapped[str] = mapped_column(String(64), nullable=False, comment="项编码（程序引用用，字典内唯一）")
    item_label: Mapped[str] = mapped_column(String(255), nullable=False, comment="显示名称")
    item_value: Mapped[str | None] = mapped_column(String(255), comment="项值（缺省与 item_code 相同）")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="显示顺序")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active 启用 / disabled 停用")
    remark: Mapped[str | None] = mapped_column(String(500), comment="备注")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_dict_item_dict_status", "dictionary_id", "status"),
        Index("ix_dict_item_dict_code", "dictionary_id", "item_code"),
    )
