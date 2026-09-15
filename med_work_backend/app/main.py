"""应用入口：应用工厂 + 启动初始化。"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.exceptions import AppError
from app.routers import (
    accounts,
    ai,
    analysis,
    audit,
    auth,
    chat,
    dictionary,
    health,
    knowledge,
    medical_record,
    notifications,
    patient,
    roles,
    wx,
)
from app.services.seed import init_db

logging.basicConfig(level=logging.INFO)

# 允许前端开发服务器跨域访问
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]


# 启动后立即同步前等待的秒数：避开启动高峰，确保依赖（Redis/网络）就绪
_WX_STARTUP_DELAY = 10


async def _wx_sync_once() -> None:
    """执行一次群同步 + 未决推送状态刷新（独立数据库会话）。"""
    from app.database import SessionLocal
    from app.services import wxwork_service

    with SessionLocal() as db:
        try:
            async with wxwork_service.SyncLock():
                result = await wxwork_service.sync_groups(db)
                logger.info(
                    "定时同步外部群完成：total=%d added=%d updated=%d failed=%d",
                    result.total, result.added, result.updated, result.failed,
                )
                changed = await wxwork_service.refresh_pending_messages(db)
                if changed:
                    logger.info("定时刷新推送状态：%d 条状态更新", changed)
        except Exception as exc:  # noqa: BLE001
            logger.warning("定时同步外部群失败：%s", exc)


async def _wx_sync_loop() -> None:
    """企业微信群定时同步循环；单次失败不影响后续周期。"""
    if settings.wx_sync_on_startup:
        await asyncio.sleep(_WX_STARTUP_DELAY)
        await _wx_sync_once()
    while True:
        await asyncio.sleep(max(settings.wx_sync_interval_hours, 1) * 3600)
        await _wx_sync_once()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """启动时初始化数据库（建表 + 演示账号种子），并按需启动群同步后台任务。"""
    init_db()
    task: asyncio.Task | None = None
    if settings.wx_sync_enabled:
        if settings.wx_configured:
            task = asyncio.create_task(_wx_sync_loop())
            logger.info(
                "企业微信群定时同步已启动（间隔 %d 小时）", settings.wx_sync_interval_hours
            )
        else:
            logger.info("企业微信凭证未配置，跳过定时同步")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    """将业务异常统一转换为 JSON 错误响应。"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "detail": exc.message},
    )


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "MED_REQUEST_VALIDATION_FAILED",
            "message": "请求参数校验未通过",
            "detail": "请求参数校验未通过",
            "errors": exc.errors(),
        },
    )


async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    fallback_codes = {
        400: "MED_BAD_REQUEST",
        401: "MED_AUTH_REQUIRED",
        403: "MED_FORBIDDEN",
        404: "MED_NOT_FOUND",
        409: "MED_RESOURCE_CONFLICT",
        422: "MED_REQUEST_VALIDATION_FAILED",
        502: "MED_AI_UPSTREAM_UNAVAILABLE",
        503: "MED_AI_PROVIDER_NOT_CONFIGURED",
    }
    message = str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": fallback_codes.get(exc.status_code, f"MED_HTTP_{exc.status_code}"),
            "message": message,
            "detail": message,
        },
    )


def create_app() -> FastAPI:
    """应用工厂：便于测试与多实例复用。"""
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="医疗 AI 智能分析工作台后端 · LangChain + Kimi (Moonshot AI) + MySQL",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

    app.include_router(health.router, prefix="/api")
    app.include_router(accounts.router, prefix="/api")
    app.include_router(ai.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(knowledge.router, prefix="/api")
    app.include_router(dictionary.router, prefix="/api")
    app.include_router(wx.router, prefix="/api")
    app.include_router(patient.router, prefix="/api")
    app.include_router(medical_record.router, prefix="/api")
    app.include_router(roles.router, prefix="/api")
    app.include_router(analysis.router, prefix="/api")
    app.include_router(audit.router, prefix="/api")
    app.include_router(notifications.router, prefix="/api")

    @app.get("/")
    async def root() -> dict:
        return {"app": settings.app_name, "docs": "/docs", "health": "/api/health"}

    return app


app = create_app()
