"""RAG 服务（服务 B）入口：独立 FastAPI 进程，仅对内网开放。

职责边界：
- 持有本地磁盘 UPLOAD_DIR 与 Qdrant 本地向量库，运行本地 embedding 模型；
- 复用同一 MySQL 实例读写 med_documents / med_document_chunks；
- 不做鉴权（由服务 A 完成），所有接口依赖 hospital_id 租户参数隔离数据；
- 不引入 langgraph / langchain（LLM 切分用轻量 httpx 客户端直连 OpenAI 兼容 API）。
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.database import Base, check_database, engine
from app.exceptions import AppError
from app.routers import documents

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 幂等建表：med_documents / med_document_chunks（若库中已存在则跳过）
    Base.metadata.create_all(bind=engine)
    logger.info("RAG 服务启动：upload_dir=%s qdrant=%s", settings.upload_dir, settings.qdrant_path)
    yield


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.code,
            "message": exc.message,
            "detail": None,
            "success": False,
        },
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "MED_VALIDATION_ERROR",
            "message": "请求参数校验失败",
            "detail": exc.errors(),
            "success": False,
        },
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": "MED_HTTP_ERROR",
            "message": str(exc.detail),
            "detail": None,
            "success": False,
        },
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

    app.include_router(documents.router)

    @app.get("/health")
    async def health() -> dict:
        from app.services import embedding_service, qdrant_service

        return {
            "status": "ok",
            "app": settings.app_name,
            "database": check_database(),
            "embedding_loaded": embedding_service.embedding_ready(),
            "vector_db_ready": qdrant_service.vector_db_ready(),
            "upload_dir": settings.upload_dir,
        }

    @app.get("/")
    async def root() -> dict:
        return {
            "app": settings.app_name,
            "docs": "/docs",
            "health": "/health",
            "note": "内部服务：请由 med_work_backend 代理调用，勿直接暴露公网",
        }

    return app


app = create_app()
