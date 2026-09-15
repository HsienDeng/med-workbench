"""企业微信外部群管理 ORM 模型。

三张表：
- med_wx_group           外部群快照（企业维度全局共享，由企微接口同步）
- med_wx_group_patient   群-患者绑定（按医院隔离，每群一位患者）
- med_wx_message         群发推送记录（按医院隔离，记录状态与企微 msgid）
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WxGroup(Base):
    """企业微信外部群（客户群）快照。

    群属于企业维度，全系统共享一份同步结果，故不加 hospital_id。
    """

    __tablename__ = "med_wx_group"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    chat_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, comment="企微群ID；手动创建群为 manual_ 前缀")
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="", comment="群名")
    owner: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="群主 userid（群发 sender）")
    owner_name: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="群主姓名")
    member_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="成员总数")
    webhook_url: Mapped[Optional[str]] = mapped_column(
        String(512), comment="群机器人 Webhook 地址（手动建群/无企微凭证时的推送通道）"
    )
    wecomapi_room_id: Mapped[Optional[str]] = mapped_column(
        String(64), comment="wecomapi 平台群 ID(roomId)，配置后走第三方通道推送（试点）"
    )
    external_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="外部联系人数量")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="跟进状态：0正常/1离职待继承/2离职继承中/3离职继承完成")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="最近成功同步时间")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_wx_group_status", "status", "deleted_at"),
    )


class WxGroupPatient(Base):
    """群-患者绑定关系（按医院隔离，同一医院内每群最多一位患者）。"""

    __tablename__ = "med_wx_group_patient"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，租户隔离")
    group_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="群ID")
    patient_id: Mapped[str] = mapped_column(String(64), nullable=False, comment="患者ID")
    patient_name: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="患者姓名快照")
    bind_by: Mapped[Optional[int]] = mapped_column(BigInteger, comment="绑定操作人 user_id")
    bind_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("uk_wx_bind_group", "hospital_id", "group_id", unique=True),
        Index("ix_wx_bind_patient", "hospital_id", "patient_id"),
    )


class WxMessage(Base):
    """企业群发推送记录。

    状态流转：pending（任务已提交，待群主在企微确认）→ sent / fail。
    wx_msgid 用于调用 get_groupmsg_send_result 回查真实发送结果。
    """

    __tablename__ = "med_wx_message"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，租户隔离")
    group_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="群ID")
    group_name: Mapped[str] = mapped_column(String(128), nullable=False, default="", comment="群名快照")
    patient_id: Mapped[Optional[str]] = mapped_column(String(64), comment="推送时绑定的患者ID快照")
    patient_name: Mapped[Optional[str]] = mapped_column(String(64), comment="推送时绑定的患者姓名快照")
    msg_type: Mapped[str] = mapped_column(String(16), nullable=False, comment="text / link")
    title: Mapped[Optional[str]] = mapped_column(String(256), comment="链接卡片标题")
    content: Mapped[Optional[str]] = mapped_column(String(4000), comment="文本内容 / 链接摘要")
    url: Mapped[Optional[str]] = mapped_column(String(2048), comment="链接卡片跳转地址")
    picurl: Mapped[Optional[str]] = mapped_column(String(2048), comment="链接卡片封面地址")
    sender: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="群发 sender（群主 userid）")
    operator_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="提交人 user_id")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", comment="pending / sent / fail")
    fail_reason: Mapped[Optional[str]] = mapped_column(String(512), comment="失败原因")
    wx_msgid: Mapped[Optional[str]] = mapped_column(String(128), comment="企微群发 msgid，用于回查结果")
    wx_fail_list: Mapped[Optional[list]] = mapped_column(JSON, comment="提交时返回的失败群ID列表")
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="企微侧最终发送时间")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_wx_msg_group", "hospital_id", "group_id", "created_at"),
        Index("ix_wx_msg_pending", "status", "created_at"),
    )
