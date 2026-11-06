import type { AppKitHandle } from './db';

// single-job mode: AppKit registers DATABRICKS_JOB_ID under the "default" key
export const JOB_KEY = 'default';

export async function triggerProcessing(appkit: AppKitHandle, sessionId: string): Promise<void> {
  const result = await appkit.jobs(JOB_KEY).runNow({ job_parameters: { session_id: sessionId } });
  if (!result.ok || !result.data?.run_id) {
    console.error(`Could not start processing for session ${sessionId}:`, result);
    await appkit.lakebase.query(
      `UPDATE articulate.sessions SET status = 'failed', status_detail = 'The processing job could not be started. Try again in a minute.', updated_at = now()
        WHERE session_id = $1`,
      [sessionId],
    );
    return;
  }
  await appkit.lakebase.query(
    `UPDATE articulate.sessions SET job_run_id = $2, status_detail = 'Queued for processing.', updated_at = now()
      WHERE session_id = $1 AND status = 'uploaded'`,
    [sessionId, result.data.run_id],
  );
}
