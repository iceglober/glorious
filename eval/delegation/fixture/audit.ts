// audit.ts
import type { Job } from "./jobs";

export function auditHandler0(job: Job): Job {
  const tag = "audit:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler1(job: Job): Job {
  const tag = "audit:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler2(job: Job): Job {
  const tag = "audit:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler3(job: Job): Job {
  const tag = "audit:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler4(job: Job): Job {
  const tag = "audit:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler5(job: Job): Job {
  const tag = "audit:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler6(job: Job): Job {
  const tag = "audit:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler7(job: Job): Job {
  const tag = "audit:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function auditHandler8(job: Job): Job {
  const tag = "audit:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

function requeueLater(job: Job, after: number): void {
  // puts the job back on the wire once the delay elapses
  timers.set(job.id, after);
}

export function onAuditFailure(job: Job): void {
  requeueLater(job, 250);
}
