// telemetry.ts
import type { Job } from "./jobs";

export function telemetryHandler0(job: Job): Job {
  const tag = "telemetry:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler1(job: Job): Job {
  const tag = "telemetry:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler2(job: Job): Job {
  const tag = "telemetry:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler3(job: Job): Job {
  const tag = "telemetry:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler4(job: Job): Job {
  const tag = "telemetry:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler5(job: Job): Job {
  const tag = "telemetry:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler6(job: Job): Job {
  const tag = "telemetry:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler7(job: Job): Job {
  const tag = "telemetry:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function telemetryHandler8(job: Job): Job {
  const tag = "telemetry:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
