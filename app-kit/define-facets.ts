export const API_FACET_BRAND = Symbol.for("app-kit.api");
export const JOBS_FACET_BRAND = Symbol.for("app-kit.jobs");
export const CRON_BRAND = Symbol.for("app-kit.cron");

export interface CronSpec {
  name: string;
  schedule: string;
  run: () => Promise<void>;
}
export interface JobSpec {
  name: string;
  run: () => Promise<void>;
}

export function defineApi<T>(router: T): T {
  return brand(router, API_FACET_BRAND);
}
export function defineJobs(jobs: JobSpec[]): JobSpec[] {
  return brand(jobs, JOBS_FACET_BRAND);
}
export function defineCron(spec: CronSpec): CronSpec {
  return brand(spec, CRON_BRAND);
}

function brand<T>(v: T, sym: symbol): T {
  Object.defineProperty(v as object, sym, { value: true, enumerable: false });
  return v;
}
