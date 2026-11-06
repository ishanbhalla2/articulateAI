import { z } from 'zod';
import { MAX_JUDGES, JUDGE_ROLES, missingForGenerate, type SessionInput } from '../../shared/domain';
import { type AppKitHandle, type QueryClient, HttpError, handle, withTransaction } from '../lib/db';
import { currentUser, isAdmin } from '../lib/identity';
import { triggerProcessing } from '../lib/processing';

const uuid = z.string().uuid();

const MediaSchema = z.object({
  media_id: uuid,
  role: z.enum(['topic', 'participant', 'judge']),
  judge_id: uuid.nullable(),
  source: z.enum(['upload', 'live']),
  media_path: z.string().min(1).max(1024),
  media_type: z.enum(['audio', 'video']),
  mime_type: z.string().max(200).nullable(),
  original_filename: z.string().max(500).nullable(),
  duration_seconds: z.number().nonnegative().nullable(),
  part_count: z.number().int().min(1).max(1000),
});

const SessionInputSchema = z.object({
  participant_name: z.string().max(200),
  topic_text: z.string().max(5000).nullable(),
  domain_key: z.string().max(100).nullable(),
  judges: z
    .array(
      z.object({
        judge_id: uuid,
        position: z.number().int().min(1).max(MAX_JUDGES),
        name: z.string().max(200),
        role: z.union([z.enum(JUDGE_ROLES), z.literal('')]),
      }),
    )
    .max(MAX_JUDGES),
  audiences: z.array(z.string().max(100)).max(50),
  media: z.array(MediaSchema).max(MAX_JUDGES + 2),
});

const SaveBody = z.object({ input: SessionInputSchema, action: z.enum(['draft', 'submit']) });

const SESSION_LIST_SQL = `
  SELECT s.session_id, s.participant_name, s.topic_text, s.domain_key, s.is_provisional, s.status,
         s.status_detail, s.current_step, s.created_at, s.created_by,
         COALESCE(d.domain_name, p.proposed_domain_name) AS domain_name,
         COALESCE((SELECT array_agg(a.audience_key ORDER BY ap.display_order)
                   FROM articulate.session_audiences a JOIN articulate.audience_profiles ap USING (audience_key)
                   WHERE a.session_id = s.session_id), '{}') AS audiences,
         (SELECT round(avg((c->>'score')::numeric), 1)
            FROM articulate.feedback_results fr, jsonb_array_elements(fr.feedback_json->'categories') c
           WHERE fr.result_id = (SELECT result_id FROM articulate.feedback_results
                                  WHERE session_id = s.session_id ORDER BY created_at DESC LIMIT 1)) AS average_score
    FROM articulate.sessions s
    LEFT JOIN LATERAL (SELECT domain_name FROM articulate.category_library
                        WHERE domain_key = s.domain_key LIMIT 1) d ON true
    LEFT JOIN LATERAL (SELECT proposed_domain_name FROM articulate.domain_proposals
                        WHERE session_id = s.session_id ORDER BY created_at DESC LIMIT 1) p ON true`;

function toNumber(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function mapSummary(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, average_score: toNumber(r.average_score) };
}

async function loadSessionOwner(tx: QueryClient, sessionId: string) {
  const { rows } = await tx.query('SELECT created_by, status FROM articulate.sessions WHERE session_id = $1 FOR UPDATE', [sessionId]);
  return rows[0] as { created_by: string; status: string } | undefined;
}

function validateMedia(sessionId: string, input: SessionInput) {
  const judgeIds = new Set(input.judges.map((j) => j.judge_id));
  for (const m of input.media) {
    if (!m.media_path.startsWith(`raw/${sessionId}/`)) throw new HttpError(400, 'Media must be stored under this session.');
    if ((m.role === 'judge') !== (m.judge_id !== null)) throw new HttpError(400, 'Judge recordings must name their judge.');
    if (m.judge_id && !judgeIds.has(m.judge_id)) throw new HttpError(400, 'A recording points at a judge that is not in this session.');
  }
  const single = (role: string) => input.media.filter((m) => m.role === role).length <= 1;
  if (!single('participant') || !single('topic')) throw new HttpError(400, 'Only one participant recording and one topic recording are allowed.');
  const perJudge = new Set(input.media.filter((m) => m.judge_id).map((m) => m.judge_id));
  if (perJudge.size !== input.media.filter((m) => m.judge_id).length) throw new HttpError(400, 'Each judge can have one recording.');
}

async function validateReferences(tx: QueryClient, input: SessionInput) {
  if (input.domain_key) {
    const { rows } = await tx.query(
      `SELECT 1 FROM articulate.category_library WHERE domain_key = $1 AND NOT is_general AND status = 'active' LIMIT 1`,
      [input.domain_key],
    );
    if (rows.length === 0) throw new HttpError(400, 'Unknown domain.');
  }
  if (input.audiences.length > 0) {
    const { rows } = await tx.query(
      'SELECT count(*)::int AS n FROM articulate.audience_profiles WHERE is_active AND audience_key = ANY($1)',
      [input.audiences],
    );
    if (Number(rows[0].n) !== new Set(input.audiences).size) throw new HttpError(400, 'Unknown audience selected.');
  }
}

async function currentSettingsSnapshot(tx: QueryClient) {
  const { rows } = await tx.query('SELECT version, provider, model_id, depth_level FROM articulate.app_settings WHERE is_current');
  const s = rows[0];
  if (!s) throw new HttpError(500, 'No current settings found. Ask an admin to save Settings.');
  return { provider: s.provider, model_id: s.model_id, depth_level: Number(s.depth_level), instructions_version: Number(s.version) };
}

export function registerSessionRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get(
      '/api/sessions',
      handle(async (req, res) => {
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
        const mine = req.query.mine === '1';
        const params: unknown[] = [];
        const where: string[] = [];
        if (search) {
          params.push(`%${search}%`);
          where.push(`(s.participant_name ILIKE $${params.length} OR s.topic_text ILIKE $${params.length})`);
        }
        if (domain) {
          params.push(domain);
          where.push(`s.domain_key = $${params.length}`);
        }
        if (mine) {
          params.push(currentUser(req));
          where.push(`s.created_by = $${params.length}`);
        }
        const sql = `${SESSION_LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT 200`;
        const { rows } = await appkit.lakebase.query(sql, params);
        res.json(rows.map(mapSummary));
      }),
    );

    app.get(
      '/api/sessions/:id',
      handle(async (req, res) => {
        const id = uuid.safeParse(req.params.id);
        if (!id.success) throw new HttpError(400, 'Invalid session id.');
        const sessionId = id.data;
        const user = currentUser(req);
        const q = appkit.lakebase;

        const { rows: sessions } = await q.query(
          `SELECT x.*, s.topic_media_path, s.domain_source, s.settings_snapshot
             FROM (${SESSION_LIST_SQL} WHERE s.session_id = $1) x
             JOIN articulate.sessions s USING (session_id)`,
          [sessionId],
        );
        if (sessions.length === 0) throw new HttpError(404, 'Session not found.');
        const session = mapSummary(sessions[0]);

        const [judges, media, feedback, rating] = await Promise.all([
          q.query('SELECT judge_id, position, name, role FROM articulate.session_judges WHERE session_id = $1 ORDER BY position', [sessionId]),
          q.query(
            `SELECT media_id, role, judge_id, source, media_path, media_type, mime_type, original_filename,
                    duration_seconds::float AS duration_seconds, part_count, audio_path, transcript_path
               FROM articulate.session_media WHERE session_id = $1 ORDER BY created_at`,
            [sessionId],
          ),
          q.query(
            `SELECT feedback_json, model_name, prompt_version, depth_level, created_at
               FROM articulate.feedback_results WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [sessionId],
          ),
          q.query('SELECT useful FROM articulate.feedback_ratings WHERE session_id = $1 AND rated_by = $2', [sessionId, user]),
        ]);

        let categories: Record<string, unknown>[] = [];
        const domainKey = session.domain_key as string | null;
        if (domainKey) {
          const { rows } = await q.query(
            `SELECT * FROM articulate.category_library WHERE domain_key IN ('general', $1) ORDER BY is_general DESC, display_order`,
            [domainKey],
          );
          categories = rows;
          if (session.is_provisional) {
            const { rows: proposals } = await q.query(
              `SELECT proposed_domain_name, proposed_categories FROM articulate.domain_proposals
                WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [sessionId],
            );
            const proposal = proposals[0];
            const proposed = (proposal?.proposed_categories ?? []) as Record<string, unknown>[];
            categories = [
              ...categories.filter((c) => c.is_general),
              ...proposed.map((c, i) => ({
                ...c,
                domain_key: domainKey,
                domain_name: proposal?.proposed_domain_name,
                is_general: false,
                display_order: i + 1,
                status: 'active',
              })),
            ];
          }
        }

        res.json({
          ...session,
          judges: judges.rows,
          media: media.rows,
          feedback: feedback.rows[0] ?? null,
          categories,
          my_rating: rating.rows[0]?.useful ?? null,
        });
      }),
    );

    app.put(
      '/api/sessions/:id',
      handle(async (req, res) => {
        const id = uuid.safeParse(req.params.id);
        if (!id.success) throw new HttpError(400, 'Invalid session id.');
        const parsed = SaveBody.safeParse(req.body);
        if (!parsed.success) throw new HttpError(400, `Invalid session: ${parsed.error.issues[0]?.message ?? 'check the form'}`);
        const sessionId = id.data;
        const { input, action } = parsed.data;
        const user = currentUser(req);

        if (!input.participant_name.trim()) throw new HttpError(400, 'Add the participant name before saving.');
        validateMedia(sessionId, input);
        if (action === 'submit') {
          const missing = missingForGenerate(input);
          if (missing.length) throw new HttpError(400, `Still missing: ${missing.join(', ')}.`);
        }

        const result = await withTransaction(appkit, async (tx) => {
          const existing = await loadSessionOwner(tx, sessionId);
          if (existing && existing.created_by !== user) throw new HttpError(403, 'Only the person who created this session can edit it.');
          if (existing && existing.status !== 'draft') throw new HttpError(409, 'This session has already been submitted.');
          await validateReferences(tx, input);

          const topicMedia = input.media.find((m) => m.role === 'topic');
          const snapshot = action === 'submit' ? await currentSettingsSnapshot(tx) : null;
          const status = action === 'submit' ? 'uploaded' : 'draft';

          await tx.query(
            `INSERT INTO articulate.sessions
               (session_id, created_by, participant_name, topic_text, topic_media_path, domain_key, domain_source, settings_snapshot, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (session_id) DO UPDATE SET
               participant_name = EXCLUDED.participant_name, topic_text = EXCLUDED.topic_text,
               topic_media_path = EXCLUDED.topic_media_path, domain_key = EXCLUDED.domain_key,
               domain_source = EXCLUDED.domain_source, settings_snapshot = EXCLUDED.settings_snapshot,
               status = EXCLUDED.status, updated_at = now()`,
            [
              sessionId,
              user,
              input.participant_name.trim(),
              input.topic_text?.trim() || null,
              topicMedia?.media_path ?? null,
              input.domain_key,
              input.domain_key ? 'user' : 'auto',
              snapshot,
              status,
            ],
          );

          await tx.query('DELETE FROM articulate.session_judges WHERE session_id = $1', [sessionId]);
          await tx.query('DELETE FROM articulate.session_media WHERE session_id = $1', [sessionId]);
          await tx.query('DELETE FROM articulate.session_audiences WHERE session_id = $1', [sessionId]);

          for (const j of input.judges) {
            await tx.query(
              'INSERT INTO articulate.session_judges (judge_id, session_id, position, name, role) VALUES ($1, $2, $3, $4, $5)',
              [j.judge_id, sessionId, j.position, j.name.trim() || null, j.role || null],
            );
          }
          for (const m of input.media) {
            await tx.query(
              `INSERT INTO articulate.session_media
                 (media_id, session_id, role, judge_id, source, media_path, media_type, mime_type, original_filename, duration_seconds, part_count)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [m.media_id, sessionId, m.role, m.judge_id, m.source, m.media_path, m.media_type, m.mime_type, m.original_filename, m.duration_seconds, m.part_count],
            );
          }
          for (const key of new Set(input.audiences)) {
            await tx.query('INSERT INTO articulate.session_audiences (session_id, audience_key) VALUES ($1, $2)', [sessionId, key]);
          }
          return { status };
        });

        if (result.status === 'uploaded') await triggerProcessing(appkit, sessionId);
        res.json({ session_id: sessionId, status: result.status });
      }),
    );

    app.post(
      '/api/sessions/:id/retry',
      handle(async (req, res) => {
        const id = uuid.safeParse(req.params.id);
        if (!id.success) throw new HttpError(400, 'Invalid session id.');
        const user = currentUser(req);
        const { rows } = await appkit.lakebase.query('SELECT created_by, status FROM articulate.sessions WHERE session_id = $1', [id.data]);
        const s = rows[0];
        if (!s) throw new HttpError(404, 'Session not found.');
        if (s.created_by !== user && !(await isAdmin(req))) throw new HttpError(403, 'Only the creator or an admin can retry this session.');
        if (s.status !== 'failed') throw new HttpError(409, 'Only failed sessions can be retried.');
        await appkit.lakebase.query(
          `UPDATE articulate.sessions SET status = 'uploaded', status_detail = NULL, current_step = NULL, job_run_id = NULL, updated_at = now() WHERE session_id = $1`,
          [id.data],
        );
        await triggerProcessing(appkit, id.data);
        res.json({ session_id: id.data, status: 'uploaded' });
      }),
    );

    app.put(
      '/api/sessions/:id/rating',
      handle(async (req, res) => {
        const id = uuid.safeParse(req.params.id);
        const body = z.object({ useful: z.boolean(), comment: z.string().max(2000).optional() }).safeParse(req.body);
        if (!id.success || !body.success) throw new HttpError(400, 'Invalid rating.');
        await appkit.lakebase.query(
          `INSERT INTO articulate.feedback_ratings (session_id, rated_by, useful, comment) VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, rated_by) DO UPDATE SET useful = EXCLUDED.useful, comment = EXCLUDED.comment, rated_at = now()`,
          [id.data, currentUser(req), body.data.useful, body.data.comment ?? null],
        );
        res.status(204).send();
      }),
    );
  });
}
