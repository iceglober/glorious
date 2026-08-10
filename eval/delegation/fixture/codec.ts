// codec.ts
import type { Job } from "./jobs";

export function codecHandler0(job: Job): Job {
  const tag = "codec:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler1(job: Job): Job {
  const tag = "codec:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler2(job: Job): Job {
  const tag = "codec:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler3(job: Job): Job {
  const tag = "codec:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler4(job: Job): Job {
  const tag = "codec:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler5(job: Job): Job {
  const tag = "codec:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler6(job: Job): Job {
  const tag = "codec:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler7(job: Job): Job {
  const tag = "codec:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function codecHandler8(job: Job): Job {
  const tag = "codec:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
