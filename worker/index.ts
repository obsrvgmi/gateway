import { env, liveGateFailures, paymentsMode } from "@/server/env";
import { beat, noticeExpiringLinks, processOutbox, promptScheduledPayouts, purgeExpired, refreshSanctionsList, reportStuck } from "@/server/jobs";
import { log } from "@/server/log";
import { pollDuePayments } from "@/server/payments/poller";
import { pollDuePayouts } from "@/server/payments/payouts";
import { pollDueRefunds } from "@/server/payments/refunds";
import { deliverDueWebhooks } from "@/server/webhooks/deliver";

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

const MINUTE = 60_000;
const jobs: Job[] = [
  { name: "poll-payments", everyMs: 2_000, run: pollDuePayments },
  { name: "poll-payouts", everyMs: 2_000, run: pollDuePayouts },
  { name: "poll-refunds", everyMs: 2_000, run: pollDueRefunds },
  { name: "outbox", everyMs: 1_000, run: processOutbox },
  { name: "webhooks", everyMs: 2_000, run: deliverDueWebhooks },
  { name: "scheduled-payouts", everyMs: 5 * MINUTE, run: promptScheduledPayouts },
  { name: "expiring-links", everyMs: 60 * MINUTE, run: noticeExpiringLinks },
  { name: "sanctions", everyMs: 24 * 60 * MINUTE, run: () => refreshSanctionsList() },
  { name: "stuck", everyMs: 60 * MINUTE, run: reportStuck },
  { name: "purge", everyMs: 60 * MINUTE, run: purgeExpired },
];

let stopping = false;

/** A run that never returns must not stop the job forever. Its work is leased, so it gets picked up again. */
const JOB_LIMIT_MS = 120_000;
const withLimit = (run: Promise<unknown>) => {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Still running after ${JOB_LIMIT_MS / 1000}s`)), JOB_LIMIT_MS);
  });
  return Promise.race([run, limit]).finally(() => clearTimeout(timer));
};

/** Each job runs on its own schedule and never overlaps itself. A failure is logged and retried next tick. */
function start(job: Job) {
  const loop = async () => {
    if (stopping) return;
    try {
      await withLimit(job.run());
      await beat(job.name);
    } catch (error) {
      log("error", "job failed", { job: job.name, error });
    }
    if (!stopping) setTimeout(() => void loop(), job.everyMs);
  };
  void loop();
}

const config = env();
log("info", "worker started", { mode: paymentsMode(), requested: config.PAYMENTS_MODE, refused: config.PAYMENTS_MODE === "live" ? liveGateFailures(config) : [] });
jobs.forEach(start);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    log("info", "worker stopping", { signal });
    setTimeout(() => process.exit(0), 3_000);
  });
}
