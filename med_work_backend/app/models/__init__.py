"""ORM 模型包，统一对外导出。新增模型时在此补充导出。"""

from app.models.ai_provider import AiProviderConfig
from app.models.analysis_record import AnalysisRecord
from app.models.audit_log import AuditLog
from app.models.chat import ChatConversation
from app.models.dictionary import Dictionary, DictionaryItem
from app.models.knowledge import Document, DocumentChunk
from app.models.medical_record import MedicalRecord
from app.models.menu import Menu, RoleMenu
from app.models.notification import Notification
from app.models.patient import Patient
from app.models.permission import Permission, RolePermission
from app.models.prompt import PromptTemplate
from app.models.rbac import Department, Hospital, RbacUser, Role, UserRole
from app.models.session import UserSession
from app.models.wx import WxGroup, WxGroupPatient, WxMessage

# 注意：旧版简单用户模型（app/models/user.py → users 表）已废弃，
# 登录/注册统一走 RBAC（med_* 表）。users 表保留在库中不再维护。
# from app.models.user import User

__all__ = [
    "AiProviderConfig",
    "AnalysisRecord",
    "AuditLog",
    "ChatConversation",
    "Department",
    "Dictionary",
    "DictionaryItem",
    "Document",
    "DocumentChunk",
    "Hospital",
    "MedicalRecord",
    "Menu",
    "Notification",
    "Patient",
    "Permission",
    "PromptTemplate",
    "RbacUser",
    "Role",
    "RoleMenu",
    "RolePermission",
    "UserRole",
    "UserSession",
    "WxGroup",
    "WxGroupPatient",
    "WxMessage",
]
