"""统一业务异常定义。

Service 层抛出这些异常，由全局异常处理器转换为 HTTP 响应，
避免 Router 层散落重复的状态码与错误文案。
"""


class AppError(Exception):
    """业务异常基类。"""

    status_code: int = 500
    code: str = "MED_INTERNAL_ERROR"
    message: str = "服务内部错误"

    def __init__(self, message: str | None = None, *, code: str | None = None) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message
        if code is not None:
            self.code = code


class AuthError(AppError):
    """认证失败（401）。"""

    status_code = 401
    code = "MED_AUTH_REQUIRED"
    message = "认证失败"


class ForbiddenError(AppError):
    """当前用户无权执行操作（403）。"""

    status_code = 403
    code = "MED_FORBIDDEN"
    message = "当前账号没有执行该操作的权限"


class ConflictError(AppError):
    """资源冲突，如账号已存在（409）。"""

    status_code = 409
    code = "MED_RESOURCE_CONFLICT"
    message = "资源冲突"


class NotFoundError(AppError):
    """资源不存在（404）。"""

    status_code = 404
    code = "MED_RESOURCE_NOT_FOUND"
    message = "资源不存在"


class UpstreamError(AppError):
    """上游服务调用失败（502）。"""

    status_code = 502
    code = "MED_AI_UPSTREAM_UNAVAILABLE"


class AiProviderNotConfigured(AppError):
    """AI 供应商未配置或配置无效（503）。"""

    status_code = 503
    code = "MED_AI_PROVIDER_NOT_CONFIGURED"


class AiProviderInvalid(AppError):
    """AI 供应商未注册或路由值无效（422）。"""

    status_code = 422
    code = "MED_AI_PROVIDER_INVALID"
    message = "AI 供应商无效"


class RedisUnavailable(AppError):
    """Redis 不可用时拒绝依赖缓存的认证操作（503）。"""

    status_code = 503
    code = "MED_REDIS_UNAVAILABLE"
    message = "缓存服务不可用，请稍后重试"


class RagServiceUnavailable(AppError):
    """RAG 服务（服务 B）不可达 / 超时（503）。"""

    status_code = 503
    code = "MED_RAG_UNAVAILABLE"
    message = "知识库服务暂不可用，请稍后重试"


class ImaApiError(AppError):
    """IMA OpenAPI 调用失败（业务错误 / 网络错误 / 非 JSON 响应，502）。"""

    status_code = 502
    code = "MED_IMA_UPSTREAM_ERROR"
    message = "IMA 服务调用失败"


class ImaNotConfigured(AppError):
    """IMA 凭证未配置（503）。工具注册阶段应避免注册，防御性兜底。"""
    status_code = 503
    code = "MED_IMA_NOT_CONFIGURED"
    message = "IMA 集成未配置，请管理员配置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY"


class WxWorkNotConfigured(AppError):
    """企业微信凭证未配置（503）。"""
    status_code = 503
    code = "MED_WX_NOT_CONFIGURED"
    message = "企业微信集成未配置，请管理员配置 WX_CORP_ID / WX_CONTACT_SECRET"


class WxWorkError(UpstreamError):
    """企业微信接口调用失败（业务错误 / 网络错误 / 非 JSON 响应，502）。"""
    code = "MED_WX_UPSTREAM_ERROR"
    message = "企业微信接口调用失败"


class WxSyncInProgress(ConflictError):
    """已有群同步任务在执行（409）。"""
    code = "MED_WX_SYNC_IN_PROGRESS"
    message = "群同步正在进行中，请稍后再试"


class WxBadRequest(AppError):
    """群管理请求参数不合法，如链接卡片缺少标题或链接（400）。"""
    status_code = 400
    code = "MED_WX_BAD_REQUEST"
    message = "请求参数不合法"
