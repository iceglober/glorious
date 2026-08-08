// dispatch.ts
import type { Job } from "./jobs";

export function dispatchHandler0(job: Job): Job {
  const tag = "dispatch:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler1(job: Job): Job {
  const tag = "dispatch:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler2(job: Job): Job {
  const tag = "dispatch:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler3(job: Job): Job {
  const tag = "dispatch:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler4(job: Job): Job {
  const tag = "dispatch:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler5(job: Job): Job {
  const tag = "dispatch:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler6(job: Job): Job {
  const tag = "dispatch:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler7(job: Job): Job {
  const tag = "dispatch:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function dispatchHandler8(job: Job): Job {
  const tag = "dispatch:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
