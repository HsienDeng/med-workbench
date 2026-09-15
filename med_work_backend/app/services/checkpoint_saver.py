"""带 med_ 表前缀的 LangGraph MySQL CheckpointSaver。

LangGraph 官方 AIOMySQLSaver 默认表名为 checkpoints / checkpoint_blobs /
checkpoint_writes / checkpoint_migrations，与项目约定的 med_ 前缀不符。
本模块通过子类化，在 SQL 层面统一追加 med_ 前缀，业务代码无感切换。
"""

from langgraph.checkpoint.mysql.aio import AIOMySQLSaver
from langgraph.checkpoint.mysql.base import (
    SELECT_PENDING_SENDS_SQL,
    SELECT_SQL,
    BaseMySQLSaver,
)

_PREFIX = "med_"
_MIGRATIONS_TABLE = f"{_PREFIX}checkpoint_migrations"


def _prefix_checkpoint_sql(sql: str) -> str:
    """把 SQL 中的 LangGraph 默认表名替换为带 med_ 前缀的表名。"""
    # 先替换较长的名字，避免 `checkpoint_blobs` 被拆成 `med_checkpoints_blobs`
    replacements = [
        ("checkpoint_migrations", f"{_PREFIX}checkpoint_migrations"),
        ("checkpoint_blobs", f"{_PREFIX}checkpoint_blobs"),
        ("checkpoint_writes", f"{_PREFIX}checkpoint_writes"),
        ("checkpoints", f"{_PREFIX}checkpoints"),
    ]
    for old, new in replacements:
        sql = sql.replace(old, new)
    return sql


class PrefixedAIOMySQLSaver(AIOMySQLSaver):
    """AIOMySQLSaver，表名统一使用 med_ 前缀。

    覆盖的 SQL 包括：
    - MIGRATIONS：建表 / 改表语句
    - UPSERT_* / INSERT_*：写入语句
    - SELECT_SQL / SELECT_PENDING_SENDS_SQL：查询语句（通过静态方法重写）
    - setup()：迁移版本表也使用 med_checkpoint_migrations
    """

    MIGRATIONS = tuple(_prefix_checkpoint_sql(m) for m in BaseMySQLSaver.MIGRATIONS)
    UPSERT_CHECKPOINT_BLOBS_SQL = _prefix_checkpoint_sql(
        BaseMySQLSaver.UPSERT_CHECKPOINT_BLOBS_SQL
    )
    UPSERT_CHECKPOINTS_SQL = _prefix_checkpoint_sql(BaseMySQLSaver.UPSERT_CHECKPOINTS_SQL)
    UPSERT_CHECKPOINT_WRITES_SQL = _prefix_checkpoint_sql(
        BaseMySQLSaver.UPSERT_CHECKPOINT_WRITES_SQL
    )
    INSERT_CHECKPOINT_WRITES_SQL = _prefix_checkpoint_sql(
        BaseMySQLSaver.INSERT_CHECKPOINT_WRITES_SQL
    )

    @staticmethod
    def _select_sql(where: str) -> str:
        return _prefix_checkpoint_sql(SELECT_SQL).replace("{WHERE}", where)

    @staticmethod
    def _select_pending_sends_sql(num_ids: int) -> str:
        placeholders = ",".join(["%s"] * num_ids)
        return _prefix_checkpoint_sql(SELECT_PENDING_SENDS_SQL).replace(
            "{CHECKPOINT_ID_PLACEHOLDERS}", placeholders
        )

    async def setup(self) -> None:
        """执行幂等建表与迁移，迁移记录表使用 med_checkpoint_migrations。"""
        async with self._cursor() as cur:
            await cur.execute(self.MIGRATIONS[0])
            await cur.execute(
                f"SELECT v FROM {_MIGRATIONS_TABLE} ORDER BY v DESC LIMIT 1"
            )
            row = await cur.fetchone()
            version = -1 if row is None else row["v"]
            for v, migration in zip(
                range(version + 1, len(self.MIGRATIONS)),
                self.MIGRATIONS[version + 1 :],
            ):
                await cur.execute(migration)
                await cur.execute(
                    f"INSERT INTO {_MIGRATIONS_TABLE} (v) VALUES (%s)", (v,)
                )
