from urllib.parse import quote_plus

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AIProviderConfig:
    """单个 OpenAI 兼容提供商的运行时路由。"""

    def __init__(self, name: str, api_key: SecretStr, base_url: str, model: str):
        self.name = name
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    @property
    def configured(self) -> bool:
        return bool(self.api_key.get_secret_value().strip())


class Settings(BaseSettings):
    """应用配置，从环境变量 / .env 读取。"""

    app_name: str = "MedAI Workbench Backend"
    app_version: str = "0.1.0"
    port: int = 8001

    # AI 供应商配置已全部迁移至数据库（med_ai_provider_configs 表），
    # 由「AI 服务与 API Key」管理页维护；此处不再提供 .env 硬编码入口。

    # AI 供应商 API Key 加密密钥（med_ai_provider_configs 表 AES-GCM）。
    # 生产必须配置；缺失时退化为开发兜底密钥并告警（见 app/clients/ai_crypto.py）。
    med_api_key_enc_key: SecretStr = SecretStr("")

    # IMA 外部集成（腾讯 ima.qq.com OpenAPI）
    # 空值表示未开通：AI 助手不注册 ima 相关工具；配置后视为管理员对医疗数据出网的授权
    ima_openapi_clientid: SecretStr = SecretStr("4c7be377682c54859a087170dc91c3c2")
    ima_openapi_apikey: SecretStr = SecretStr("1NZJjF0Sb7HjS55uLh/HCv3DpTS8o76AVDv1ROgTI7qJ5I1Yo0dgBQvSOiyDDSiIMSoawm137A==")

    # MySQL 数据库
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "med_workbench"

    # 认证会话
    session_ttl_hours: int = 12  # 登录令牌有效期（小时）

    # ===== 企业微信（客户联系：外部群管理 + 企业群发）=====
    wx_corp_id: SecretStr = SecretStr("")
    wx_contact_secret: SecretStr = SecretStr("")
    wx_sync_enabled: bool = False          # 定时同步总开关（默认关，无凭证时不影响启动）
    wx_sync_interval_hours: int = 6        # 定时同步间隔（小时）
    wx_sync_on_startup: bool = True        # 启动时是否立即同步一次
    wx_sync_page_size: int = 100           # 群列表分页大小（企微限制 1~1000）
    wx_owner_userids: str = ""             # 可选：逗号分隔群主 userid；为空则拉应用可见范围内全部群主
    wx_http_timeout: float = 30.0          # 企微接口超时（秒）

    # ===== 企业微信（第三方通道试点：wecomapi.com，非官方协议）=====
    # 官方群机器人不支持外部群（客户群），故试点第三方协议通道向外部群主动发消息。
    # 风险声明：非官方接口有风控/封号风险，仅建议测试账号小范围试点，勿用于真实患者数据生产。
    wx_wecomapi_token: SecretStr = SecretStr("")   # 平台 Token（wecomapi 管理后台获取）
    wx_wecomapi_base_url: str = "http://manager.wecomapi.com/wecom/finder/api"
    wx_wecomapi_guid: str = ""                     # 设备 guid（扫码登录成功后填写）
    wx_wecomapi_area_code: int = 320000            # 设备地区 ID（如 320000=江苏省）
    wx_wecomapi_device_name: str = "med-workbench" # 设备名称
    wx_wecomapi_proxy_url: str = ""                # socks5 代理（可选，如 socks5://user:pass@127.0.0.12:8080）

    # Redis（登录令牌存储与缓存）
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    redis_db: int = 0

    # ===== RAG 服务（服务 B，med_rag_service）=====
    # 知识库文档管理/向量检索全部由独立的 med_rag_service 进程承载，本服务仅做 HTTP 代理转发。
    # UPLOAD_DIR 仅作为参考信息传递给服务 B；本进程不操作上传磁盘。
    upload_dir: str = "./data/uploads"
    # RAG 服务地址（服务 B，默认端口 8002，仅内网）
    rag_service_base_url: str = "http://127.0.0.1:8002"
    # RAG 请求超时（秒）：上传 + LLM 切分 + 向量化同步执行，需放宽
    rag_service_timeout: float = 300.0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def ima_configured(self) -> bool:
        """IMA OpenAPI 凭证是否完整配置(视为管理员对 IMA 数据出网的授权)。"""
        return bool(
            self.ima_openapi_clientid.get_secret_value().strip()
            and self.ima_openapi_apikey.get_secret_value().strip()
        )

    @property
    def wx_configured(self) -> bool:
        """企业微信凭证是否完整配置。"""
        return bool(
            self.wx_corp_id.get_secret_value().strip()
            and self.wx_contact_secret.get_secret_value().strip()
        )

    @property
    def wx_owner_filter(self) -> list[str]:
        """解析 WX_OWNER_USERIDS 为群主 userid 列表（空配置返回空列表）。"""
        return [item.strip() for item in self.wx_owner_userids.split(",") if item.strip()]

    @property
    def wx_wecomapi_configured(self) -> bool:
        """wecomapi 通道是否就绪（Token + 已登录设备 guid）。"""
        return bool(
            self.wx_wecomapi_token.get_secret_value().strip()
            and self.wx_wecomapi_guid.strip()
        )

    @property
    def database_url(self) -> str:
        """SQLAlchemy 连接串（密码做 URL 编码，避免特殊字符破坏连接串）。"""
        return (
            "mysql+pymysql://"
            f"{quote_plus(self.db_user)}:{quote_plus(self.db_password)}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"
        )


settings = Settings()
