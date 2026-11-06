import { type AppKitHandle, handle } from '../lib/db';
import { adminGroupName, currentUser, isAdmin } from '../lib/identity';

export function registerReferenceRoutes(appkit: AppKitHandle) {
  appkit.server.extend((app) => {
    app.get(
      '/api/me',
      handle(async (req, res) => {
        const email = currentUser(req);
        res.json({ email, is_admin: await isAdmin(req), admin_group: adminGroupName() });
      }),
    );

    app.get(
      '/api/reference',
      handle(async (_req, res) => {
        const [audiences, categories] = await Promise.all([
          appkit.lakebase.query('SELECT * FROM articulate.audience_profiles WHERE is_active ORDER BY display_order'),
          appkit.lakebase.query(
            `SELECT * FROM articulate.category_library WHERE status = 'active' ORDER BY is_general DESC, domain_name, display_order`,
          ),
        ]);
        res.json({ audiences: audiences.rows, categories: categories.rows });
      }),
    );
  });
}
