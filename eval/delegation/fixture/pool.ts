// pool.ts
import type { Job } from "./jobs";

export function poolHandler0(job: Job): Job {
  const tag = "pool:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler1(job: Job): Job {
  const tag = "pool:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler2(job: Job): Job {
  const tag = "pool:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler3(job: Job): Job {
  const tag = "pool:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler4(job: Job): Job {
  const tag = "pool:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler5(job: Job): Job {
  const tag = "pool:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler6(job: Job): Job {
  const tag = "pool:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler7(job: Job): Job {
  const tag = "pool:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function poolHandler8(job: Job): Job {
  const tag = "pool:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

function enqueueAgain(job: Job, after: number): void {
  // puts the job back on the wire once the delay elapses
  timers.set(job.id, after);
}

export function onPoolFailure(job: Job): void {
  enqueueAgain(job, 250);
}
