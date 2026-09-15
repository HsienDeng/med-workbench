"""数据库引擎与会话管理（SQLAlchemy 2.0 + PyMySQL，与服务 A 共用同一 MySQL 实例）。"""
import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,   # 取连接前探测，避免拿到已失效连接
    pool_recycle=3600,    # 连接复用 1 小时后重建，规避 MySQL wait_timeout 断连
    pool_size=5,
    max_overflow=10,
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def get_db():
    """FastAPI 依赖：提供请求级数据库会话，请求结束自动关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database() -> bool:
    """快速连通性探测，用于健康检查。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Database connectivity check failed: %s", exc)
        return False
