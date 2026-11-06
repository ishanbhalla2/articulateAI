import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@databricks/appkit-ui/react';
import { Plus, Trash2 } from 'lucide-react';
import {
  AUDIENCE_CLUSTERS,
  DEFAULT_JUDGE_SLOTS,
  JUDGE_ROLES,
  MAX_JUDGES,
  MIN_JUDGES,
  missingForGenerate,
  type MediaRef,
  type SessionDetail,
  type SessionInput,
} from '../../../shared/domain';
import { EMPTY_SLOT, MediaInput, type MediaSlot } from '../components/MediaInput';
import { ErrorBlock, LoadingBlock, PageHeader } from '../components/States';
import { api, domainsFrom, useApi, type Reference } from '../lib/api';

interface JudgeDraft {
  judge_id: string;
  name: string;
  role: string;
  slot: MediaSlot;
}

const AUTO = '__auto__';

function newJudge(): JudgeDraft {
  return { judge_id: crypto.randomUUID(), name: '', role: '', slot: EMPTY_SLOT };
}

function slotFrom(media: MediaRef | undefined): MediaSlot {
  if (!media) return EMPTY_SLOT;
  const { role: _role, judge_id: _judge, ...rest } = media;
  return { state: 'ready', media: rest, progress: 1, error: null, previewUrl: null };
}

export function NewSessionPage() {
  const { id: draftId } = useParams();
  const reference = useApi<Reference>('/api/reference');
  const draft = useApi<SessionDetail>(draftId ? `/api/sessions/${draftId}` : null);

  if (reference.loading || (draftId && draft.loading)) return <LoadingBlock rows={5} />;
  if (reference.error || !reference.data) return <ErrorBlock message={reference.error ?? 'Could not load reference data.'} onRetry={reference.reload} />;
  if (draftId && (draft.error || !draft.data)) return <ErrorBlock message={draft.error ?? 'Draft not found.'} onRetry={draft.reload} />;
  if (draft.data && draft.data.status !== 'draft') return <ErrorBlock message="This session has already been submitted and can no longer be edited." />;

  return <SessionForm key={draftId ?? 'new'} reference={reference.data} draft={draft.data} />;
}

function SessionForm({ reference, draft }: { reference: Reference; draft: SessionDetail | null }) {
  const navigate = useNavigate();
  const [sessionId] = useState(() => draft?.session_id ?? crypto.randomUUID());
  const [participantName, setParticipantName] = useState(draft?.participant_name ?? '');
  const draftTopicMedia = draft?.media.find((m) => m.role === 'topic');
  const [topicMode, setTopicMode] = useState<'text' | 'media'>(draftTopicMedia ? 'media' : 'text');
  const [topicText, setTopicText] = useState(draft?.topic_text ?? '');
  const [topicSlot, setTopicSlot] = useState<MediaSlot>(slotFrom(draftTopicMedia));
  const [domainKey, setDomainKey] = useState(draft?.domain_source === 'user' && draft.domain_key ? draft.domain_key : AUTO);
  const [participantSlot, setParticipantSlot] = useState<MediaSlot>(slotFrom(draft?.media.find((m) => m.role === 'participant')));
  const [judges, setJudges] = useState<JudgeDraft[]>(() =>
    draft && draft.judges.length > 0
      ? draft.judges.map((j) => ({
          judge_id: j.judge_id,
          name: j.name ?? '',
          role: j.role ?? '',
          slot: slotFrom(draft.media.find((m) => m.judge_id === j.judge_id)),
        }))
      : Array.from({ length: DEFAULT_JUDGE_SLOTS }, newJudge),
  );
  const [audiences, setAudiences] = useState<Set<string>>(new Set(draft?.audiences ?? []));
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const domains = useMemo(() => domainsFrom(reference.categories), [reference.categories]);
  const general = reference.categories.filter((c) => c.is_general);

  const input: SessionInput = useMemo(() => {
    const media: MediaRef[] = [];
    if (participantSlot.media) media.push({ ...participantSlot.media, role: 'participant', judge_id: null });
    if (topicMode === 'media' && topicSlot.media) media.push({ ...topicSlot.media, role: 'topic', judge_id: null });
    for (const j of judges) if (j.slot.media) media.push({ ...j.slot.media, role: 'judge', judge_id: j.judge_id });
    return {
      participant_name: participantName,
      topic_text: topicMode === 'text' ? topicText : null,
      domain_key: domainKey === AUTO ? null : domainKey,
      judges: judges.map((j, i) => ({ judge_id: j.judge_id, position: i + 1, name: j.name, role: j.role })),
      audiences: [...audiences],
      media,
    };
  }, [participantName, topicMode, topicText, topicSlot, domainKey, participantSlot, judges, audiences]);

  const uploading = [participantSlot, topicSlot, ...judges.map((j) => j.slot)].some((s) => s.state === 'uploading');
  const missing = missingForGenerate(input);
  const judgesReady = judges.filter((j) => j.slot.state === 'ready').length;

  function updateJudge(id: string, patch: Partial<JudgeDraft>) {
    setJudges((js) => js.map((j) => (j.judge_id === id ? { ...j, ...patch } : j)));
  }

  function updateJudgeSlot(id: string, next: MediaSlot | ((prev: MediaSlot) => MediaSlot)) {
    setJudges((js) => js.map((j) => (j.judge_id === id ? { ...j, slot: typeof next === 'function' ? next(j.slot) : next } : j)));
  }

  async function save(action: 'draft' | 'submit') {
    setSaving(action);
    setError(null);
    try {
      await api(`/api/sessions/${sessionId}`, { method: 'PUT', body: JSON.stringify({ input, action }) });
      if (action === 'submit') {
        void navigate(`/sessions/${sessionId}`);
      } else {
        setSavedAt(new Date());
        if (!draft) void navigate(`/sessions/${sessionId}/edit`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (uploading) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={draft ? 'Edit draft session' : 'New session'} description="Record or upload the talk and the judges' feedback, then choose who the talk was for." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Participant and topic</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="participant">Participant name</Label>
                <Input id="participant" value={participantName} onChange={(e) => setParticipantName(e.target.value)} placeholder="e.g. Alex Morgan" maxLength={200} />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Topic</Label>
                  <ToggleGroup type="single" size="sm" variant="outline" value={topicMode} onValueChange={(v) => v && setTopicMode(v === 'media' ? 'media' : 'text')} aria-label="Topic as text or media">
                    <ToggleGroupItem value="text">Text</ToggleGroupItem>
                    <ToggleGroupItem value="media">Audio or video</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                {topicMode === 'text' ? (
                  <Textarea value={topicText} onChange={(e) => setTopicText(e.target.value)} placeholder="What was the talk about?" rows={3} maxLength={5000} aria-label="Topic" />
                ) : (
                  <MediaInput sessionId={sessionId} role="topic" label="Topic recording" value={topicSlot} onChange={setTopicSlot} />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Select value={domainKey} onValueChange={setDomainKey}>
                  <SelectTrigger id="domain" className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>Auto-detect from topic</SelectItem>
                    {domains.map((d) => (
                      <SelectItem key={d.domain_key} value={d.domain_key}>
                        {d.domain_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Sets the five specialised feedback categories.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Recordings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Participant</h3>
                  <ReadyBadge ready={participantSlot.state === 'ready'} />
                </div>
                <MediaInput sessionId={sessionId} role="participant" label="Participant recording" value={participantSlot} onChange={setParticipantSlot} />
              </div>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Judges</h3>
                  <p className="text-sm text-muted-foreground">
                    {judgesReady} of {judges.length} have a recording · at least one is required
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setJudges((js) => [...js, newJudge()])} disabled={judges.length >= MAX_JUDGES}>
                  <Plus className="h-4 w-4" /> Add judge
                </Button>
              </div>

              <div className="space-y-4">
                {judges.map((j, i) => (
                  <div key={j.judge_id} className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
                        {i + 1}
                      </span>
                      <h4 className="font-medium">Judge {i + 1}</h4>
                      <ReadyBadge ready={j.slot.state === 'ready'} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setJudges((js) => js.filter((x) => x.judge_id !== j.judge_id))}
                        disabled={judges.length <= MIN_JUDGES || j.slot.state === 'uploading'}
                        aria-label={`Remove judge ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`judge-name-${j.judge_id}`}>Name</Label>
                        <Input id={`judge-name-${j.judge_id}`} value={j.name} onChange={(e) => updateJudge(j.judge_id, { name: e.target.value })} placeholder="Judge name" maxLength={200} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`judge-role-${j.judge_id}`}>Role / expertise</Label>
                        <Select value={j.role} onValueChange={(v) => updateJudge(j.judge_id, { role: v })}>
                          <SelectTrigger id={`judge-role-${j.judge_id}`} className="w-full">
                            <SelectValue placeholder="Choose a role" />
                          </SelectTrigger>
                          <SelectContent>
                            {JUDGE_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <MediaInput sessionId={sessionId} role="judge" label={`Judge ${i + 1} recording`} value={j.slot} onChange={(next) => updateJudgeSlot(j.judge_id, next)} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Audience</CardTitle>
              <CardDescription>Who was the talk for? Every selected audience counts equally.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-3">
              {AUDIENCE_CLUSTERS.map((cluster) => (
                <fieldset key={cluster.key} className="space-y-3">
                  <legend className="mb-2 text-sm font-semibold">{cluster.label}</legend>
                  {reference.audiences
                    .filter((a) => a.cluster === cluster.key)
                    .map((a) => (
                      <div key={a.audience_key} className="flex items-center gap-2">
                        <Checkbox
                          id={`aud-${a.audience_key}`}
                          checked={audiences.has(a.audience_key)}
                          onCheckedChange={(checked) =>
                            setAudiences((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(a.audience_key);
                              else next.delete(a.audience_key);
                              return next;
                            })
                          }
                        />
                        <Label htmlFor={`aud-${a.audience_key}`} className="font-normal">
                          {a.display_name}
                        </Label>
                      </div>
                    ))}
                </fieldset>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {(missing.length > 0 || uploading) && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {uploading ? 'Waiting for uploads to finish. ' : ''}
                {missing.length > 0 ? `To generate feedback, add: ${missing.join(', ')}.` : ''}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => void save('draft')} disabled={saving !== null || uploading || !participantName.trim()}>
                {saving === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button onClick={() => void save('submit')} disabled={saving !== null || uploading || missing.length > 0}>
                {saving === 'submit' ? 'Submitting…' : 'Generate feedback'}
              </Button>
              {savedAt && <span className="text-sm text-muted-foreground">Draft saved at {savedAt.toLocaleTimeString('en-GB')}</span>}
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you&apos;ll get</CardTitle>
              <CardDescription>A 1–5 score, timestamped evidence, the judges&apos; view and one improvement for each of 10 categories.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="mb-1 font-medium">General</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {general.map((c) => (
                    <li key={c.category_key}>{c.category_name}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">Specialised</p>
                <p className="text-muted-foreground">
                  {domainKey === AUTO
                    ? 'Five categories for the domain detected from the topic.'
                    : reference.categories
                        .filter((c) => c.domain_key === domainKey)
                        .map((c) => c.category_name)
                        .join(' · ')}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recording tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li>Use a quiet room and keep the microphone close.</li>
                <li>Record each judge separately so feedback is attributed correctly.</li>
                <li>Video lets the model look at presence and body language.</li>
                <li>Files up to 2 GB; long uploads continue while you fill in the form.</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ReadyBadge({ ready }: { ready: boolean }) {
  return ready ? <Badge className="bg-success text-success-foreground">Ready</Badge> : <Badge variant="outline">No recording yet</Badge>;
}
