// hooks.ts
import type { Job } from "./jobs";

export function hooksHandler0(job: Job): Job {
  const tag = "hooks:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler1(job: Job): Job {
  const tag = "hooks:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler2(job: Job): Job {
  const tag = "hooks:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler3(job: Job): Job {
  const tag = "hooks:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler4(job: Job): Job {
  const tag = "hooks:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler5(job: Job): Job {
  const tag = "hooks:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler6(job: Job): Job {
  const tag = "hooks:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler7(job: Job): Job {
  const tag = "hooks:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function hooksHandler8(job: Job): Job {
  const tag = "hooks:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
