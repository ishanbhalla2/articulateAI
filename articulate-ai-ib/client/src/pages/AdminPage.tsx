import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@databricks/appkit-ui/react';
import type { AudienceProfile, Category, DomainProposal } from '../../../shared/domain';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '../components/States';
import { api, formatDate, useApi, type Me } from '../lib/api';

export function AdminPage({ me }: { me: Me }) {
  if (!me.is_admin) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Admin" />
        <EmptyBlock title="Admins only" description={`Ask a member of the "${me.admin_group}" group for access.`} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Admin" description="Review domains the model proposed and maintain the category library and audience profiles." />
      <Tabs defaultValue="proposals">
        <TabsList>
          <TabsTrigger value="proposals">Domain proposals</TabsTrigger>
          <TabsTrigger value="categories">Category library</TabsTrigger>
          <TabsTrigger value="audiences">Audience profiles</TabsTrigger>
        </TabsList>
        <TabsContent value="proposals" className="mt-4">
          <Proposals />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoryLibrary />
        </TabsContent>
        <TabsContent value="audiences" className="mt-4">
          <AudienceProfiles />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, run };
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (done) return <p className="text-sm text-success" role="status">{done}</p>;
  return null;
}

function Proposals() {
  const proposals = useApi<DomainProposal[]>('/api/admin/proposals');
  if (proposals.loading && !proposals.data) return <LoadingBlock />;
  if (proposals.error || !proposals.data) return <ErrorBlock message={proposals.error ?? 'Could not load proposals.'} onRetry={proposals.reload} />;
  if (proposals.data.length === 0)
    return <EmptyBlock title="No proposals" description="When a topic doesn't fit an existing domain, the model's proposed domain appears here for review." />;
  return (
    <div className="space-y-4">
      {proposals.data.map((p) => (
        <ProposalCard key={p.proposal_id} proposal={p} onChanged={proposals.reload} />
      ))}
    </div>
  );
}

function ProposalCard({ proposal, onChanged }: { proposal: DomainProposal; onChanged: () => void }) {
  const [name, setName] = useState(proposal.proposed_domain_name);
  const [cats, setCats] = useState(proposal.proposed_categories);
  const saver = useSaver();
  const pending = proposal.status === 'pending';
  const body = () => JSON.stringify({ proposed_domain_name: name, proposed_categories: cats });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{proposal.proposed_domain_name}</CardTitle>
          <Badge variant={pending ? 'secondary' : proposal.status === 'approved' ? 'default' : 'outline'}>{proposal.status}</Badge>
        </div>
        <CardDescription>
          Key <code>{proposal.proposed_domain_key}</code> · proposed {formatDate(proposal.created_at)}
          {proposal.session_id && (
            <>
              {' '}
              from{' '}
              <Link className="underline" to={`/sessions/${proposal.session_id}`}>
                this session
              </Link>
            </>
          )}
          {proposal.reviewed_by && ` · reviewed by ${proposal.reviewed_by}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`pname-${proposal.proposal_id}`}>Domain name</Label>
          <Input id={`pname-${proposal.proposal_id}`} value={name} onChange={(e) => setName(e.target.value)} disabled={!pending} />
        </div>
        <Accordion type="multiple" className="rounded-md border px-4">
          {cats.map((c, i) => (
            <AccordionItem key={i} value={String(i)}>
              <AccordionTrigger>{c.category_name || `Category ${i + 1}`}</AccordionTrigger>
              <AccordionContent>
                <CategoryFields
                  value={c}
                  disabled={!pending}
                  onChange={(next) => setCats((prev) => prev.map((x, j) => (j === i ? { ...x, ...next } : x)))}
                  idPrefix={`${proposal.proposal_id}-${i}`}
                  showKey
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <Feedback error={saver.error} done={saver.done} />
        {pending && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saver.busy}
              onClick={() => void saver.run('Approved and added to the library.', async () => {
                await api(`/api/admin/proposals/${proposal.proposal_id}/approve`, { method: 'POST', body: body() });
                onChanged();
              })}
            >
              Approve
            </Button>
            <Button variant="outline" disabled={saver.busy} onClick={() => void saver.run('Edits saved.', () => api(`/api/admin/proposals/${proposal.proposal_id}`, { method: 'PUT', body: body() }))}>
              Save edits
            </Button>
            <Button
              variant="ghost"
              disabled={saver.busy}
              onClick={() => void saver.run('Rejected.', async () => {
                await api(`/api/admin/proposals/${proposal.proposal_id}/reject`, { method: 'POST' });
                onChanged();
              })}
            >
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CategoryText {
  category_key?: string;
  category_name: string;
  description: string;
  anchor_1: string;
  anchor_3: string;
  anchor_5: string;
}

function CategoryFields({
  value,
  onChange,
  disabled,
  idPrefix,
  showKey,
}: {
  value: CategoryText;
  onChange: (next: Partial<CategoryText>) => void;
  disabled?: boolean;
  idPrefix: string;
  showKey?: boolean;
}) {
  const field = (key: keyof CategoryText, label: string, multiline = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      {multiline ? (
        <Textarea id={`${idPrefix}-${key}`} rows={2} value={value[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} disabled={disabled} />
      ) : (
        <Input id={`${idPrefix}-${key}`} value={value[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} disabled={disabled} />
      )}
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {showKey && field('category_key', 'Key')}
      {field('category_name', 'Name')}
      <div className="sm:col-span-2">{field('description', 'What it assesses', true)}</div>
      {field('anchor_1', 'Score 1 looks like', true)}
      {field('anchor_3', 'Score 3 looks like', true)}
      <div className="sm:col-span-2">{field('anchor_5', 'Score 5 looks like', true)}</div>
    </div>
  );
}

function CategoryLibrary() {
  const categories = useApi<Category[]>('/api/admin/categories');
  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of categories.data ?? []) m.set(c.domain_name, [...(m.get(c.domain_name) ?? []), c]);
    return [...m];
  }, [categories.data]);
  if (categories.loading && !categories.data) return <LoadingBlock />;
  if (categories.error || !categories.data) return <ErrorBlock message={categories.error ?? 'Could not load categories.'} onRetry={categories.reload} />;
  return (
    <div className="space-y-6">
      {groups.map(([domain, items]) => (
        <Card key={domain}>
          <CardHeader>
            <CardTitle className="text-base">{domain}</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple">
              {items.map((c) => (
                <AccordionItem key={c.category_key} value={c.category_key}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      {c.category_name}
                      {c.status === 'retired' && <Badge variant="outline">Retired</Badge>}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <CategoryEditor category={c} onSaved={categories.reload} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategoryEditor({ category, onSaved }: { category: Category; onSaved: () => void }) {
  const [value, setValue] = useState(category);
  const saver = useSaver();
  return (
    <div className="space-y-3">
      <CategoryFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} idPrefix={`${category.domain_key}-${category.category_key}`} />
      <div className="flex items-center gap-2">
        <Switch id={`${category.domain_key}-${category.category_key}-active`} checked={value.status === 'active'} onCheckedChange={(on) => setValue((v) => ({ ...v, status: on ? 'active' : 'retired' }))} />
        <Label htmlFor={`${category.domain_key}-${category.category_key}-active`} className="font-normal">
          Active
        </Label>
      </div>
      <Feedback error={saver.error} done={saver.done} />
      <Button
        size="sm"
        disabled={saver.busy}
        onClick={() =>
          void saver.run('Saved. New sessions will use this wording.', async () => {
            const { category_name, description, anchor_1, anchor_3, anchor_5, status } = value;
            await api(`/api/admin/categories/${category.domain_key}/${category.category_key}`, {
              method: 'PUT',
              body: JSON.stringify({ category_name, description, anchor_1, anchor_3, anchor_5, status }),
            });
            onSaved();
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

function AudienceProfiles() {
  const audiences = useApi<AudienceProfile[]>('/api/admin/audiences');
  if (audiences.loading && !audiences.data) return <LoadingBlock />;
  if (audiences.error || !audiences.data) return <ErrorBlock message={audiences.error ?? 'Could not load audiences.'} onRetry={audiences.reload} />;
  return (
    <Card>
      <CardContent className="pt-2">
        <Accordion type="multiple">
          {audiences.data.map((a) => (
            <AccordionItem key={a.audience_key} value={a.audience_key}>
              <AccordionTrigger>
                <span className="flex items-center gap-2">
                  {a.display_name}
                  <Badge variant="outline" className="font-normal">{a.cluster.replace('_', ' ')}</Badge>
                  {!a.is_active && <Badge variant="outline">Hidden</Badge>}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <AudienceEditor audience={a} onSaved={audiences.reload} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function AudienceEditor({ audience, onSaved }: { audience: AudienceProfile; onSaved: () => void }) {
  const [value, setValue] = useState(audience);
  const saver = useSaver();
  const id = (k: string) => `${audience.audience_key}-${k}`;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id('name')}>Display name</Label>
          <Input id={id('name')} value={value.display_name} onChange={(e) => setValue({ ...value, display_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('depth')}>Depth</Label>
          <Input id={id('depth')} value={value.depth} onChange={(e) => setValue({ ...value, depth: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={id('cares')}>Cares about</Label>
          <Textarea id={id('cares')} rows={2} value={value.cares_about} onChange={(e) => setValue({ ...value, cares_about: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={id('mistakes')}>Common presenter mistakes</Label>
          <Textarea id={id('mistakes')} rows={2} value={value.common_mistakes} onChange={(e) => setValue({ ...value, common_mistakes: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch id={id('active')} checked={value.is_active} onCheckedChange={(on) => setValue({ ...value, is_active: on })} />
        <Label htmlFor={id('active')} className="font-normal">
          Show on the New session page
        </Label>
      </div>
      <Feedback error={saver.error} done={saver.done} />
      <Button
        size="sm"
        disabled={saver.busy}
        onClick={() =>
          void saver.run('Saved.', async () => {
            const { display_name, depth, cares_about, common_mistakes, is_active } = value;
            await api(`/api/admin/audiences/${audience.audience_key}`, { method: 'PUT', body: JSON.stringify({ display_name, depth, cares_about, common_mistakes, is_active }) });
            onSaved();
          })
        }
      >
        Save
      </Button>
    </div>
  );
}
