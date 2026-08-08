// errors.ts
import type { Job } from "./jobs";

export function errorsHandler0(job: Job): Job {
  const tag = "errors:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler1(job: Job): Job {
  const tag = "errors:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler2(job: Job): Job {
  const tag = "errors:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler3(job: Job): Job {
  const tag = "errors:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler4(job: Job): Job {
  const tag = "errors:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler5(job: Job): Job {
  const tag = "errors:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler6(job: Job): Job {
  const tag = "errors:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler7(job: Job): Job {
  const tag = "errors:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function errorsHandler8(job: Job): Job {
  const tag = "errors:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
