import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from '@databricks/appkit-ui/react';
import { Plus, Search } from 'lucide-react';
import type { SessionSummary } from '../../../shared/domain';
import { isRunning, ProgressTracker, StatusBadge } from '../components/SessionStatus';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '../components/States';
import { api, domainsFrom, formatDate, useApi, type Reference } from '../lib/api';

const ALL = '__all__';
const POLL_MS = 5000;

export function SessionsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [domain, setDomain] = useState(ALL);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [retrying, setRetrying] = useState<string | null>(null);
  const reference = useApi<Reference>('/api/reference');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('search', debounced);
    if (domain !== ALL) p.set('domain', domain);
    if (scope === 'mine') p.set('mine', '1');
    return `/api/sessions?${p.toString()}`;
  }, [debounced, domain, scope]);

  const sessions = useApi<SessionSummary[]>(query);
  const running = (sessions.data ?? []).filter(isRunning);
  const audienceNames = useMemo(
    () => new Map((reference.data?.audiences ?? []).map((a) => [a.audience_key, a.display_name])),
    [reference.data],
  );

  const { reload } = sessions;
  useEffect(() => {
    if (running.length === 0) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [running.length, reload]);

  async function retry(id: string) {
    setRetrying(id);
    try {
      await api(`/api/sessions/${id}/retry`, { method: 'POST' });
      sessions.reload();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="My sessions"
        description="Track processing and open feedback."
        actions={
          <Button asChild>
            <Link to="/">
              <Plus className="h-4 w-4" /> New session
            </Link>
          </Button>
        }
      />

      {running.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">In progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {running.map((s) => (
              <div key={s.session_id} className="space-y-2">
                <Link to={`/sessions/${s.session_id}`} className="font-medium hover:underline">
                  {s.participant_name}
                </Link>
                <ProgressTracker session={s} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Search participant or topic" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sessions" />
        </div>
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Filter by domain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All domains</SelectItem>
            {domainsFrom(reference.data?.categories ?? []).map((d) => (
              <SelectItem key={d.domain_key} value={d.domain_key}>
                {d.domain_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v === 'all' ? 'all' : 'mine')} aria-label="Whose sessions">
          <ToggleGroupItem value="mine">Created by me</ToggleGroupItem>
          <ToggleGroupItem value="all">Everyone</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {sessions.loading && !sessions.data ? (
        <LoadingBlock />
      ) : sessions.error ? (
        <ErrorBlock message={sessions.error} onRetry={sessions.reload} />
      ) : !sessions.data || sessions.data.length === 0 ? (
        <EmptyBlock
          title={debounced || domain !== ALL ? 'No sessions match these filters' : 'No sessions yet'}
          description={debounced || domain !== ALL ? 'Try a different search or domain.' : 'Create a session to get feedback on a talk.'}
          action={
            <Button asChild variant="outline">
              <Link to="/">New session</Link>
            </Button>
          }
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participant</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Audiences</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Avg score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.data.map((s) => {
                const href = s.status === 'draft' ? `/sessions/${s.session_id}/edit` : `/sessions/${s.session_id}`;
                return (
                  <TableRow key={s.session_id} className="cursor-pointer" onClick={() => void navigate(href)}>
                    <TableCell className="font-medium">
                      <Link to={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.participant_name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate" title={s.topic_text ?? undefined}>
                      {s.topic_text ?? <span className="text-muted-foreground">Recorded topic</span>}
                    </TableCell>
                    <TableCell>{s.domain_name ?? <span className="text-muted-foreground">Auto</span>}</TableCell>
                    <TableCell>
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {s.audiences.slice(0, 3).map((a) => (
                          <Badge key={a} variant="outline" className="font-normal">
                            {audienceNames.get(a) ?? a}
                          </Badge>
                        ))}
                        {s.audiences.length > 3 && <Badge variant="outline">+{s.audiences.length - 3}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge session={s} />
                        {s.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto p-0"
                            disabled={retrying === s.session_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void retry(s.session_id);
                            }}
                          >
                            Retry
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.average_score !== null ? `${s.average_score.toFixed(1)} / 5` : '–'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
