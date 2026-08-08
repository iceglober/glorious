// clock.ts
import type { Job } from "./jobs";

export function clockHandler0(job: Job): Job {
  const tag = "clock:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler1(job: Job): Job {
  const tag = "clock:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler2(job: Job): Job {
  const tag = "clock:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler3(job: Job): Job {
  const tag = "clock:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler4(job: Job): Job {
  const tag = "clock:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler5(job: Job): Job {
  const tag = "clock:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler6(job: Job): Job {
  const tag = "clock:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler7(job: Job): Job {
  const tag = "clock:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function clockHandler8(job: Job): Job {
  const tag = "clock:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

function deferJob(job: Job, after: number): void {
  // puts the job back on the wire once the delay elapses
  timers.set(job.id, after);
}

export function onClockFailure(job: Job): void {
  deferJob(job, 250);
}
