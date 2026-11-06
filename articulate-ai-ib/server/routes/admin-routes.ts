import { z } from 'zod';
import { type AppKitHandle, HttpError, handle, withTransaction } from '../lib/db';
import { requireAdmin } from '../lib/identity';

const text = (max: number) => z.string().trim().min(1).max(max);

const ProposedCategory = z.object({
  category_key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'Category keys use lower-case letters, numbers and underscores'),
  category_name: text(200),
  description: text(1000),
  anchor_1: text(1000),
  anchor_3: text(1000),
  anchor_5: text(1000),
});

const ProposalEdit = z.object({
  proposed_domain_name: text(200),
  proposed_categories: z.array(ProposedCategory).length(5),
});

const CategoryEdit = z.object({
  category_name: text(200),
  description: text(1000),
  anchor_1: text(1000),
  anchor_3: text(1000),
  anchor_5: text(1000),
  status: z.enum(['active', 'retired']),
});

const AudienceEdit = z.object({
  display_name: text(200),
  depth: text(100),
  cares_about: text(1000),
  common_mistakes: text(1000),
  is_active: z.boolean(),
});

export function registerAdminRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get(
      '/api/admin/proposals',
      handle(async (req, res) => {
        await requireAdmin(req);
        const { rows } = await appkit.lakebase.query(
          `SELECT * FROM articulate.domain_proposals ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`,
        );
        res.json(rows);
      }),
    );

    app.put(
      '/api/admin/proposals/:id',
      handle(async (req, res) => {
        await requireAdmin(req);
        const body = ProposalEdit.safeParse(req.body);
        if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? 'Invalid proposal');
        const { rows } = await appkit.lakebase.query(
          `UPDATE articulate.domain_proposals SET proposed_domain_name = $2, proposed_categories = $3
            WHERE proposal_id = $1 AND status = 'pending' RETURNING *`,
          [req.params.id, body.data.proposed_domain_name, JSON.stringify(body.data.proposed_categories)],
        );
        if (!rows[0]) throw new HttpError(404, 'Pending proposal not found.');
        res.json(rows[0]);
      }),
    );

    app.post(
      '/api/admin/proposals/:id/approve',
      handle(async (req, res) => {
        const email = await requireAdmin(req);
        const body = ProposalEdit.safeParse(req.body);
        if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? 'Invalid proposal');
        const result = await withTransaction(appkit, async (tx) => {
          const { rows } = await tx.query(
            `SELECT proposed_domain_key FROM articulate.domain_proposals WHERE proposal_id = $1 AND status = 'pending' FOR UPDATE`,
            [req.params.id],
          );
          const domainKey = rows[0]?.proposed_domain_key as string | undefined;
          if (!domainKey) throw new HttpError(404, 'Pending proposal not found.');
          const { rows: clash } = await tx.query('SELECT 1 FROM articulate.category_library WHERE domain_key = $1 LIMIT 1', [domainKey]);
          if (clash.length) throw new HttpError(409, `A domain with key "${domainKey}" already exists in the library.`);

          for (const [i, c] of body.data.proposed_categories.entries()) {
            await tx.query(
              `INSERT INTO articulate.category_library
                 (domain_key, domain_name, category_key, category_name, description, anchor_1, anchor_3, anchor_5, is_general, display_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
              [domainKey, body.data.proposed_domain_name, c.category_key, c.category_name, c.description, c.anchor_1, c.anchor_3, c.anchor_5, i + 1],
            );
          }
          await tx.query(
            `UPDATE articulate.domain_proposals
                SET status = 'approved', proposed_domain_name = $2, proposed_categories = $3, reviewed_by = $4, reviewed_at = now()
              WHERE proposal_id = $1`,
            [req.params.id, body.data.proposed_domain_name, JSON.stringify(body.data.proposed_categories), email],
          );
          await tx.query('UPDATE articulate.sessions SET is_provisional = false WHERE domain_key = $1 AND is_provisional', [domainKey]);
          return { domain_key: domainKey };
        });
        res.json(result);
      }),
    );

    app.post(
      '/api/admin/proposals/:id/reject',
      handle(async (req, res) => {
        const email = await requireAdmin(req);
        const { rows } = await appkit.lakebase.query(
          `UPDATE articulate.domain_proposals SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
            WHERE proposal_id = $1 AND status = 'pending' RETURNING proposal_id`,
          [req.params.id, email],
        );
        if (!rows[0]) throw new HttpError(404, 'Pending proposal not found.');
        res.status(204).send();
      }),
    );

    app.get(
      '/api/admin/categories',
      handle(async (req, res) => {
        await requireAdmin(req);
        const { rows } = await appkit.lakebase.query(
          'SELECT * FROM articulate.category_library ORDER BY is_general DESC, domain_name, display_order',
        );
        res.json(rows);
      }),
    );

    app.put(
      '/api/admin/categories/:domain/:category',
      handle(async (req, res) => {
        await requireAdmin(req);
        const body = CategoryEdit.safeParse(req.body);
        if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? 'Invalid category');
        const c = body.data;
        const { rows } = await appkit.lakebase.query(
          `UPDATE articulate.category_library
              SET category_name = $3, description = $4, anchor_1 = $5, anchor_3 = $6, anchor_5 = $7, status = $8
            WHERE domain_key = $1 AND category_key = $2 RETURNING *`,
          [req.params.domain, req.params.category, c.category_name, c.description, c.anchor_1, c.anchor_3, c.anchor_5, c.status],
        );
        if (!rows[0]) throw new HttpError(404, 'Category not found.');
        res.json(rows[0]);
      }),
    );

    app.get(
      '/api/admin/audiences',
      handle(async (req, res) => {
        await requireAdmin(req);
        const { rows } = await appkit.lakebase.query('SELECT * FROM articulate.audience_profiles ORDER BY display_order');
        res.json(rows);
      }),
    );

    app.put(
      '/api/admin/audiences/:key',
      handle(async (req, res) => {
        await requireAdmin(req);
        const body = AudienceEdit.safeParse(req.body);
        if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? 'Invalid audience');
        const a = body.data;
        const { rows } = await appkit.lakebase.query(
          `UPDATE articulate.audience_profiles
              SET display_name = $2, depth = $3, cares_about = $4, common_mistakes = $5, is_active = $6
            WHERE audience_key = $1 RETURNING *`,
          [req.params.key, a.display_name, a.depth, a.cares_about, a.common_mistakes, a.is_active],
        );
        if (!rows[0]) throw new HttpError(404, 'Audience not found.');
        res.json(rows[0]);
      }),
    );
  });
}
