"""API 路由包，统一对外导出。新增路由时在此注册。"""

from app.routers import auth, chat, dictionary, health, knowledge

__all__ = ["auth", "chat", "dictionary", "health", "knowledge"]
