// backoff.ts
import type { Job } from "./jobs";

export function backoffHandler0(job: Job): Job {
  const tag = "backoff:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler1(job: Job): Job {
  const tag = "backoff:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler2(job: Job): Job {
  const tag = "backoff:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler3(job: Job): Job {
  const tag = "backoff:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler4(job: Job): Job {
  const tag = "backoff:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler5(job: Job): Job {
  const tag = "backoff:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler6(job: Job): Job {
  const tag = "backoff:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler7(job: Job): Job {
  const tag = "backoff:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function backoffHandler8(job: Job): Job {
  const tag = "backoff:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
