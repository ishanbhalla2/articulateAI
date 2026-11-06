import { z } from 'zod';
import { type AppKitHandle, HttpError, handle, withTransaction } from '../lib/db';
import { adminGroupName, currentUser, isAdmin, requireAdmin } from '../lib/identity';

const SettingsBody = z.object({
  llm_instructions: z.string().trim().min(20).max(20000),
  provider: z.string().min(1),
  model_id: z.string().min(1),
  depth_level: z.number().int().min(1).max(5),
});

export function registerSettingsRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get(
      '/api/settings',
      handle(async (req, res) => {
        currentUser(req);
        const [current, models] = await Promise.all([
          appkit.lakebase.query(
            'SELECT version, llm_instructions, provider, model_id, depth_level, updated_by, updated_at FROM articulate.app_settings WHERE is_current',
          ),
          appkit.lakebase.query('SELECT * FROM articulate.model_catalog ORDER BY provider, display_name'),
        ]);
        res.json({
          current: current.rows[0] ?? null,
          models: models.rows,
          can_edit: await isAdmin(req),
          admin_group: adminGroupName(),
        });
      }),
    );

    app.put(
      '/api/settings',
      handle(async (req, res) => {
        const email = await requireAdmin(req);
        const parsed = SettingsBody.safeParse(req.body);
        if (!parsed.success) throw new HttpError(400, `Invalid settings: ${parsed.error.issues[0]?.message ?? 'check the form'}`);
        const s = parsed.data;

        const saved = await withTransaction(appkit, async (tx) => {
          const { rows: model } = await tx.query(
            'SELECT enabled FROM articulate.model_catalog WHERE provider = $1 AND model_id = $2',
            [s.provider, s.model_id],
          );
          if (!model[0]?.enabled) throw new HttpError(400, 'That model is not available.');
          await tx.query('UPDATE articulate.app_settings SET is_current = false WHERE is_current');
          const { rows } = await tx.query(
            `INSERT INTO articulate.app_settings (llm_instructions, provider, model_id, depth_level, is_current, updated_by)
             VALUES ($1, $2, $3, $4, true, $5)
             RETURNING version, llm_instructions, provider, model_id, depth_level, updated_by, updated_at`,
            [s.llm_instructions, s.provider, s.model_id, s.depth_level, email],
          );
          return rows[0];
        });
        res.json(saved);
      }),
    );
  });
}
