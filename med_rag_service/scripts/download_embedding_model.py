"""下载 bge-base-zh-v1.5 嵌入模型到项目 models/ 目录。

用法：
    python scripts/download_embedding_model.py

说明：向量化模型由 RAG 服务（med_rag_service）加载，
med_rag_service/.env 中 EMBEDDING_MODEL_NAME 指向本目录：
    EMBEDDING_MODEL_NAME=./models/bge-base-zh-v1.5
首次接入 / 更换机器时执行一次。
"""

import os
import sys

MODEL_ID = "BAAI/bge-base-zh-v1.5"
LOCAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "bge-base-zh-v1.5")


def main() -> None:
    try:
        from modelscope import snapshot_download
    except ImportError:
        print("未安装 modelscope，请先执行：pip install modelscope")
        sys.exit(1)

    print(f"从 ModelScope 下载 {MODEL_ID} → {LOCAL_DIR} ...")
    snapshot_download(MODEL_ID, local_dir=LOCAL_DIR)
    print("下载完成。确认 config.json 与 pytorch_model.bin 已就位于该目录即可。")


if __name__ == "__main__":
    main()
