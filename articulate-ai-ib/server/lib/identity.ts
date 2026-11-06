import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';
import { HttpError } from './db';

const ADMIN_GROUP = process.env.ARTICULATE_ADMIN_GROUP ?? 'admins';
const ADMIN_CACHE_MS = 5 * 60 * 1000;
const adminCache = new Map<string, { isAdmin: boolean; at: number }>();

export function currentUser(req: Request): string {
  const email = req.header('x-forwarded-email');
  if (email) return email;
  // the Apps proxy injects identity headers; locally there is no proxy
  if (process.env.NODE_ENV === 'development' && process.env.DEV_USER_EMAIL) return process.env.DEV_USER_EMAIL;
  throw new HttpError(401, 'Could not identify the signed-in user.');
}

// SCIM user search is very slow in this workspace (~30s); /Me with the user's own token answers in ~0.2s.
async function groupsOf(req: Request): Promise<string[]> {
  const token = req.header('x-forwarded-access-token');
  if (token) {
    const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
    const url = `${host.startsWith('http') ? host : `https://${host}`}/api/2.0/preview/scim/v2/Me?attributes=groups`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`SCIM Me returned ${res.status}`);
    const body = (await res.json()) as { groups?: { display?: string }[] };
    return (body.groups ?? []).flatMap((g) => (g.display ? [g.display] : []));
  }
  if (process.env.NODE_ENV === 'development') {
    const me = await getExecutionContext().client.currentUser.me();
    return (me.groups ?? []).flatMap((g) => (g.display ? [g.display] : []));
  }
  throw new Error('No user token was forwarded; check the app keeps the default iam.current-user:read user scope.');
}

export async function isAdmin(req: Request): Promise<boolean> {
  const email = currentUser(req);
  const cached = adminCache.get(email);
  if (cached && Date.now() - cached.at < ADMIN_CACHE_MS) return cached.isAdmin;

  let admin = false;
  try {
    admin = (await groupsOf(req)).includes(ADMIN_GROUP);
  } catch (err) {
    console.error('Admin group lookup failed; treating user as non-admin:', err);
  }
  adminCache.set(email, { isAdmin: admin, at: Date.now() });
  return admin;
}

export async function requireAdmin(req: Request): Promise<string> {
  const email = currentUser(req);
  if (!(await isAdmin(req))) throw new HttpError(403, `Only members of the "${ADMIN_GROUP}" group can do this.`);
  return email;
}

export function adminGroupName(): string {
  return ADMIN_GROUP;
}
