"""复现对话页 'str' object is not callable 错误：直接调用 agent_service.chat_stream。"""
import asyncio
import traceback
from types import SimpleNamespace

from app.schemas.chat import ChatRequest
from app.services import agent_service

req = ChatRequest(messages=[{"role": "user", "content": "你好"}])
user = SimpleNamespace(id=1, hospital_id=1)


async def main():
    try:
        async for piece in agent_service.chat_stream(req, user):
            print(repr(piece))
    except Exception:
        traceback.print_exc()


asyncio.run(main())
