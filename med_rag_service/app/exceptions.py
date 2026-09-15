"""统一业务异常定义（与服务 A 保持一致，错误码 MED_XXX 不变）。

Service 层抛出这些异常，由全局异常处理器转换为 HTTP 响应。
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


class NotFoundError(AppError):
    """资源不存在（404）。"""

    status_code = 404
    code = "MED_RESOURCE_NOT_FOUND"
    message = "资源不存在"


class UpstreamError(AppError):
    """上游服务调用失败（502）。"""

    status_code = 502
    code = "MED_AI_UPSTREAM_UNAVAILABLE"
