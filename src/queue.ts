import type { ExecutionRequest } from "./types.js";
import { executeRequest } from "./bridge.js";

// ---------------------------------------------------------------------------
// Concurrency Queue — extracted from transport.ts
// ---------------------------------------------------------------------------

export interface QueueStatus {
  active: number;
  queued: number;
  maxConcurrent: number;
}

export interface Queue {
  submit(request: ExecutionRequest): void;
  getStatus(): QueueStatus;
}

export function createQueue(maxConcurrent: number): Queue {
  const pending: ExecutionRequest[] = [];
  let activeCount = 0;

  function runRequest(request: ExecutionRequest): void {
    activeCount++;
    console.log(
      `[Queue] Executing ${request.id} (active: ${activeCount}/${maxConcurrent}, queued: ${pending.length})`,
    );

    executeRequest(request)
      .catch((err) => {
        console.error(`[Queue] Error processing ${request.id}:`, err);
      })
      .finally(() => {
        activeCount--;
        console.log(
          `[Queue] Finished ${request.id} (active: ${activeCount}/${maxConcurrent}, queued: ${pending.length})`,
        );

        if (pending.length > 0) {
          const next = pending.shift()!;
          console.log(
            `[Queue] Dequeuing ${next.id} (${pending.length} still queued)`,
          );
          runRequest(next);
        }
      });
  }

  return {
    submit(request: ExecutionRequest): void {
      if (activeCount >= maxConcurrent) {
        pending.push(request);
        console.log(
          `[Queue] Enqueued ${request.id} — at capacity (active: ${activeCount}/${maxConcurrent}, queued: ${pending.length})`,
        );
      } else {
        runRequest(request);
      }
    },

    getStatus(): QueueStatus {
      return { active: activeCount, queued: pending.length, maxConcurrent };
    },
  };
}
