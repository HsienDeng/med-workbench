"""API Key 对称加密（AES-GCM）。

密文结构：nonce(12) || tag(16) || ciphertext；
加密密钥 = SHA-256(MED_API_KEY_ENC_KEY)。
未配置密钥时退化为固定开发密钥并告警（仅供本地开发，生产必须配置）。
"""

import logging
import os
from hashlib import sha256

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

logger = logging.getLogger(__name__)

_NONCE_SIZE = 12
# 开发兜底密钥：与生产无关，避免本地未配置时启动失败
_DEV_FALLBACK_SECRET = "med-workbench-dev-only-key"

_key_warned = False


def _derive_key() -> bytes:
    """从环境变量派生 256 位 AES 密钥；缺失时用开发兜底并告警一次。"""
    global _key_warned
    raw = settings.med_api_key_enc_key.get_secret_value().strip()
    if raw:
        return sha256(raw.encode("utf-8")).digest()
    if not _key_warned:
        logger.warning(
            "MED_API_KEY_ENC_KEY 未配置，API Key 使用开发兜底密钥加密（仅限本地开发，生产必须配置）"
        )
        _key_warned = True
    return sha256(_DEV_FALLBACK_SECRET.encode("utf-8")).digest()


def encrypt_api_key(plaintext: str) -> bytes:
    """加密 API Key；空串返回空 bytes（表示未配置）。"""
    if not plaintext:
        return b""
    nonce = os.urandom(_NONCE_SIZE)
    cipher = AESGCM(_derive_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + cipher


def decrypt_api_key(blob: bytes | None) -> str:
    """解密 API Key；空值返回空串，解密失败抛 ValueError（旧密钥/密文损坏）。"""
    if not blob:
        return ""
    if len(blob) <= _NONCE_SIZE:
        raise ValueError("API Key 密文长度非法")
    nonce, ciphertext = blob[:_NONCE_SIZE], blob[_NONCE_SIZE:]
    plain = AESGCM(_derive_key()).decrypt(nonce, ciphertext, None)
    return plain.decode("utf-8")
