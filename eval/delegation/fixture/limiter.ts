// limiter.ts
import type { Job } from "./jobs";

export function limiterHandler0(job: Job): Job {
  const tag = "limiter:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler1(job: Job): Job {
  const tag = "limiter:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler2(job: Job): Job {
  const tag = "limiter:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler3(job: Job): Job {
  const tag = "limiter:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler4(job: Job): Job {
  const tag = "limiter:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler5(job: Job): Job {
  const tag = "limiter:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler6(job: Job): Job {
  const tag = "limiter:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler7(job: Job): Job {
  const tag = "limiter:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function limiterHandler8(job: Job): Job {
  const tag = "limiter:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
