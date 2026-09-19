"""RAG 服务配置：仅包含数据库、上传目录、向量库、embedding、切分与 LLM 切分凭证。

服务 B（med_rag_service）不承载任何对外鉴权，hospital_id 租户参数由上游服务 A
校验后透传；本进程唯一持有磁盘写入（UPLOAD_DIR）与 Qdrant 本地向量库。
"""
from urllib.parse import quote_plus

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量 / .env 读取。"""

    app_name: str = "MedWorkbench RAG Service"
    app_version: str = "1.0.0"
    port: int = 8002

    # MySQL 数据库（与 med_work_backend 共用同一实例，读写 med_documents / med_document_chunks）
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "med_workbench"

    # 上传文件存储根目录（本服务唯一持有磁盘写入）
    upload_dir: str = "./data/uploads"
    # Qdrant 本地模式数据目录（向量直接落盘，无需单独部署服务）
    qdrant_path: str = "./data/qdrant"

    # 向量化模型：HuggingFace 模型名或本机已下载的模型目录绝对路径
    embedding_model_name: str = "BAAI/bge-base-zh-v1.5"
    embedding_device: str = "cpu"
    embedding_batch_size: int = 8

    # 文本分块参数
    chunk_size: int = 500
    chunk_overlap: int = 100
    max_upload_mb: int = 50

    # LLM 语义切分：上传时调用第三方 OpenAI 兼容 API 按章节/语义切块，失败自动回退规则切分
    llm_chunking: bool = True
    # 单批送入 LLM 的字符上限（防止超出模型上下文窗口）
    llm_chunk_max_input: int = 12000
    # LLM 切分所用 OpenAI 兼容提供商
    llm_api_key: SecretStr = SecretStr("")
    llm_base_url: str = "https://api.o98k.de/v1"
    llm_model: str = "gpt-5.6-sol"
    llm_timeout: float = 120.0

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
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
