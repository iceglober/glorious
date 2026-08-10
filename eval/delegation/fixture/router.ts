// router.ts
import type { Job } from "./jobs";

export function routerHandler0(job: Job): Job {
  const tag = "router:0";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler1(job: Job): Job {
  const tag = "router:1";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler2(job: Job): Job {
  const tag = "router:2";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler3(job: Job): Job {
  const tag = "router:3";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler4(job: Job): Job {
  const tag = "router:4";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler5(job: Job): Job {
  const tag = "router:5";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler6(job: Job): Job {
  const tag = "router:6";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler7(job: Job): Job {
  const tag = "router:7";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}

export function routerHandler8(job: Job): Job {
  const tag = "router:8";
  if (!job.id) throw new Error("missing id");
  return { ...job, trail: [...job.trail, tag] };
}
