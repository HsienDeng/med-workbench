"""Redis 客户端封装：登录令牌存储与用户信息缓存。"""
import logging

import redis

from app.config import settings
from app.exceptions import RedisUnavailable

logger = logging.getLogger(__name__)

_OPERATIONS = {
    redis.Redis.get: "GET",
    redis.Redis.set: "SET",
    redis.Redis.delete: "DEL",
    redis.Redis.ping: "PING",
}


def _run_redis_operation(operation, *args, **kwargs):
    """执行 Redis 操作；连接或超时失败必须显式拒绝请求。"""
    try:
        return operation(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Redis %s failed: %s",
            _OPERATIONS.get(operation, operation.__name__.upper()),
            exc,
        )
        raise RedisUnavailable from exc


def _build_client() -> redis.Redis:
    return redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password or None,
        db=settings.redis_db,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        socket_keepalive=True,
        health_check_interval=30,
    )


redis_client = _build_client()


def check_redis() -> bool:
    """连通性探测，用于健康检查。"""
    try:
        return bool(_run_redis_operation(redis_client.ping))
    except RedisUnavailable:
        return False


def redis_get(key: str) -> str | None:
    return _run_redis_operation(redis_client.get, key)


def redis_set(key: str, value: str, ttl: int) -> None:
    _run_redis_operation(redis_client.set, key, value, ex=max(ttl, 1))


def redis_set_persistent(key: str, value: str) -> None:
    _run_redis_operation(redis_client.set, key, value)


def redis_delete(key: str) -> None:
    _run_redis_operation(redis_client.delete, key)


def redis_setnx(key: str, value: str, ttl: int) -> bool:
    """原子性抢占锁；返回 True 表示抢锁成功。"""
    return bool(_run_redis_operation(redis_client.set, key, value, ex=max(ttl, 1), nx=True))
