"""APScheduler wrapper for one-shot and recurring robot actions."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger


@dataclass
class ScheduledJob:
    id: str
    description: str
    next_run: str


class RobotScheduler:
    def __init__(self) -> None:
        self._sched = AsyncIOScheduler()
        self._descriptions: dict[str, str] = {}

    def start(self) -> None:
        if not self._sched.running:
            self._sched.start()

    def shutdown(self) -> None:
        if self._sched.running:
            self._sched.shutdown(wait=False)

    def schedule_once(
        self,
        when: datetime,
        action: Callable[[], Awaitable[Any]],
        description: str,
    ) -> ScheduledJob:
        job_id = uuid.uuid4().hex[:8]
        self._sched.add_job(action, DateTrigger(run_date=when), id=job_id, name=description)
        self._descriptions[job_id] = description
        return ScheduledJob(id=job_id, description=description, next_run=when.isoformat())

    def schedule_cron(
        self,
        cron_expr: str,
        action: Callable[[], Awaitable[Any]],
        description: str,
    ) -> ScheduledJob:
        trigger = CronTrigger.from_crontab(cron_expr)
        job_id = uuid.uuid4().hex[:8]
        self._sched.add_job(action, trigger, id=job_id, name=description)
        self._descriptions[job_id] = description
        job = self._sched.get_job(job_id)
        next_run = job.next_run_time.isoformat() if job and job.next_run_time else "unknown"
        return ScheduledJob(id=job_id, description=description, next_run=next_run)

    def list_jobs(self) -> list[ScheduledJob]:
        out: list[ScheduledJob] = []
        for job in self._sched.get_jobs():
            out.append(
                ScheduledJob(
                    id=job.id,
                    description=self._descriptions.get(job.id, job.name or "(no description)"),
                    next_run=job.next_run_time.isoformat() if job.next_run_time else "n/a",
                )
            )
        return out

    def cancel(self, job_id: str) -> bool:
        try:
            self._sched.remove_job(job_id)
            self._descriptions.pop(job_id, None)
            return True
        except Exception:
            return False
