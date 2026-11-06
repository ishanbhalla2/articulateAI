import type { Application, Request, Response } from 'express';

type Row = Record<string, unknown>;

export interface QueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface AppKitHandle {
  lakebase: QueryClient & {
    pool: { connect(): Promise<QueryClient & { release(): void }> };
  };
  server: { extend(fn: (app: Application) => void): void };
  jobs(key: string): {
    runNow(params?: Record<string, unknown>): Promise<{ ok: boolean; data?: { run_id?: number } }>;
  };
}

export async function withTransaction<T>(appkit: AppKitHandle, fn: (tx: QueryClient) => Promise<T>): Promise<T> {
  const client = await appkit.lakebase.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error(`${req.method} ${req.path} failed:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}
