/** Browser-safe diagnostic completion hook. Wait duration includes scheduling,
 * command processing and GPU work; it is not GPU timer-query duration. */
export async function waitForArtGpuCompletion(gl, options = {}) {
  const now = options.now ?? (() => performance.now());
  const yieldTurn = options.yieldTurn ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  const timeoutMs = options.timeoutMs ?? 120000;
  const start = now(), sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) throw new Error('Art GPU fence creation failed');
  let polls = 0, pollCallMs = 0, yieldedWallMs = 0;
  const yieldIntervalsMs = [];
  try {
    gl.flush();
    for (;;) {
      const beforePoll = now();
      const status = gl.clientWaitSync(sync, 0, 0);
      pollCallMs += now() - beforePoll; polls++;
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        return { waitMs: now() - start, polls, pollCallMs, yieldedWallMs, yieldIntervalsMs, status };
      }
      if (status === gl.WAIT_FAILED || gl.isContextLost()) throw new Error('Art GPU completion failed');
      if (now() - start >= timeoutMs) throw new Error('Art GPU completion timed out');
      const beforeYield = now(); await yieldTurn();
      const elapsed = now() - beforeYield; yieldedWallMs += elapsed; yieldIntervalsMs.push(elapsed);
    }
  } finally { gl.deleteSync(sync); }
}
