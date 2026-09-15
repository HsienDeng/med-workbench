"""密码哈希与校验工具（标准库 PBKDF2-SHA256，零第三方依赖）。"""
import hashlib
import hmac
import secrets

_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    """生成带随机盐的 PBKDF2 哈希，格式：pbkdf2$<salt>$<digest>。"""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), _ITERATIONS
    ).hex()
    return f"pbkdf2${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    """校验明文密码与存储哈希是否一致（恒定时间比较防时序攻击）。"""
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), _ITERATIONS
    ).hex()
    return hmac.compare_digest(candidate, digest)
