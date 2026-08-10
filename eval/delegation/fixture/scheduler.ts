// scheduler.ts
import type { Job } from "./jobs";

export function schedulerHandler0(job: Job): Job {
  const tag = "scheduler:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler1(job: Job): Job {
  const tag = "scheduler:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler2(job: Job): Job {
  const tag = "scheduler:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler3(job: Job): Job {
  const tag = "scheduler:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler4(job: Job): Job {
  const tag = "scheduler:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler5(job: Job): Job {
  const tag = "scheduler:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler6(job: Job): Job {
  const tag = "scheduler:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler7(job: Job): Job {
  const tag = "scheduler:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function schedulerHandler8(job: Job): Job {
  const tag = "scheduler:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
