import asyncio
from typing import Any, Awaitable, Callable, Coroutine, Dict


class TaskScheduler:
    def __init__(self):
        self._tasks: Dict[str, asyncio.Task] = {}

    def run_task(self, key: str, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        """즉시 실행되는 백그라운드 코루틴 태스크 등록 (기존 동일 키 태스크는 자동 취소)"""
        self.cancel(key)

        async def _runner():
            try:
                await coro
            except asyncio.CancelledError:
                pass
            except Exception as e:
                print(f"[Scheduler Task Error] key={key}: {e}")
            finally:
                if self._tasks.get(key) is asyncio.current_task():
                    self._tasks.pop(key, None)

        task = asyncio.create_task(_runner())
        self._tasks[key] = task
        return task

    def schedule_once(
        self,
        key: str,
        delay: float,
        callback: Callable[..., Awaitable[Any]],
        *args: Any
    ) -> asyncio.Task:
        """일정 시간(delay초) 후 콜백을 1회 실행하는 타이머 예약"""
        async def _delayed():
            await asyncio.sleep(delay)
            await callback(*args)

        return self.run_task(key, _delayed())

    def cancel(self, key: str):
        """특정 키의 태스크/타이머 취소"""
        task = self._tasks.pop(key, None)
        if task and not task.done():
            task.cancel()

    def cancel_prefix(self, prefix: str):
        """특정 접두사로 시작하는 모든 태스크/타이머 일괄 취소"""
        matched_keys = [k for k in self._tasks if k.startswith(prefix)]
        for key in matched_keys:
            self.cancel(key)

    def cancel_all(self):
        """등록된 모든 태스크/타이머 전체 취소"""
        for key in list(self._tasks.keys()):
            self.cancel(key)

    def is_running(self, key: str) -> bool:
        task = self._tasks.get(key)
        return task is not None and not task.done()


scheduler = TaskScheduler()