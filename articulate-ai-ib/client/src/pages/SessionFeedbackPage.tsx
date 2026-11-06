import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ScrollArea,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { ChevronDown, FileText, Play, Printer, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Category, FeedbackCategory, JudgeInput, SessionDetail } from '../../../shared/domain';
import { isRunning, ProgressTracker, StatusBadge } from '../components/SessionStatus';
import { ErrorBlock, LoadingBlock } from '../components/States';
import { api, formatDate, formatDuration, mediaUrl, useApi, type Reference } from '../lib/api';

const POLL_MS = 5000;
const FIT_LABEL = { served_well: 'Served well', partly: 'Partly served', underserved: 'Underserved' } as const;

function parseTimestamp(ts: string): number | null {
  const parts = ts.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function SessionFeedbackPage() {
  const { id } = useParams();
  const session = useApi<SessionDetail>(`/api/sessions/${id}`);
  const reference = useApi<Reference>('/api/reference');
  const { reload } = session;
  const running = session.data ? isRunning(session.data) : false;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  if (session.loading && !session.data) return <LoadingBlock rows={6} />;
  if (session.error || !session.data) return <ErrorBlock message={session.error ?? 'Session not found.'} onRetry={session.reload} />;
  return <FeedbackView session={session.data} reference={reference.data} onChanged={session.reload} />;
}

function FeedbackView({ session, reference, onChanged }: { session: SessionDetail; reference: Reference | null; onChanged: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audienceName = useMemo(() => new Map((reference?.audiences ?? []).map((a) => [a.audience_key, a.display_name])), [reference]);
  const participant = session.media.find((m) => m.role === 'participant');
  const playable = participant?.audio_path ?? null;
  const feedback = session.feedback?.feedback_json ?? null;

  function playFrom(ts: string) {
    const seconds = parseTimestamp(ts);
    const el = audioRef.current;
    if (seconds === null || !el) return;
    el.currentTime = seconds;
    void el.play();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{session.participant_name}</h2>
            <p className="text-sm text-muted-foreground">
              {formatDate(session.created_at)} · {session.domain_name ?? 'Domain not chosen yet'}
              {session.settings_snapshot ? ` · ${session.settings_snapshot.model_id}, depth ${session.settings_snapshot.depth_level}` : ''}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <TranscriptsDialog session={session} />
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!feedback}>
              <Printer className="h-4 w-4" /> Export PDF
            </Button>
          </div>
        </div>
        <p className="text-sm">
          <span className="font-medium">Topic: </span>
          {session.topic_text ?? <span className="text-muted-foreground">recorded topic</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge session={session} />
          {session.audiences.map((a) => (
            <Badge key={a} variant="outline" className="font-normal">
              {audienceName.get(a) ?? a}
            </Badge>
          ))}
        </div>
      </header>

      {session.is_provisional && (
        <Alert>
          <AlertTitle>Provisional categories</AlertTitle>
          <AlertDescription>
            No existing domain fitted this topic, so the five specialised categories were proposed by the model and are waiting for an admin to review them.
          </AlertDescription>
        </Alert>
      )}

      {!feedback ? (
        <NoFeedbackYet session={session} onChanged={onChanged} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <Summary session={session} />
            {playable && (
              <Card className="no-print">
                <CardContent className="flex flex-wrap items-center gap-3 pt-6">
                  <span className="text-sm font-medium">Participant audio</span>
                  <audio ref={audioRef} src={mediaUrl(playable)} controls preload="metadata" className="min-w-0 flex-1" />
                </CardContent>
              </Card>
            )}
            <CategoryGroup title="General" items={feedback.categories.filter((c) => c.is_general)} session={session} audienceName={audienceName} onPlay={playable ? playFrom : null} />
            <CategoryGroup
              title={session.domain_name ?? 'Specialised'}
              items={feedback.categories.filter((c) => !c.is_general)}
              session={session}
              audienceName={audienceName}
              onPlay={playable ? playFrom : null}
            />
          </div>
          <SidePanel session={session} audienceName={audienceName} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function NoFeedbackYet({ session, onChanged }: { session: SessionDetail; onChanged: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      await api(`/api/sessions/${session.session_id}/retry`, { method: 'POST' });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  if (session.status === 'draft') {
    return (
      <Alert>
        <AlertTitle>This session is a draft</AlertTitle>
        <AlertDescription>
          <Link to={`/sessions/${session.session_id}/edit`} className="underline">
            Finish the draft
          </Link>{' '}
          to generate feedback.
        </AlertDescription>
      </Alert>
    );
  }
  if (session.status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Processing failed</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{session.status_detail ?? 'The processing job did not finish.'}</p>
          {error && <p>{error}</p>}
          <Button
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={() => void retry()}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generating feedback</CardTitle>
        <CardDescription>This page updates by itself. You can leave and come back later.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProgressTracker session={session} />
        <div className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function Summary({ session }: { session: SessionDetail }) {
  const fb = session.feedback!.feedback_json;
  const overall = fb.categories.length ? fb.categories.reduce((a, c) => a + c.score, 0) / fb.categories.length : null;
  const m = fb.delivery_metrics;
  const tiles = [
    { label: 'Pace', value: `${Math.round(m.words_per_minute)}`, unit: 'words / min' },
    { label: 'Filler words', value: m.filler_words_per_minute.toFixed(1), unit: `per min · ${m.filler_word_count} total` },
    { label: 'Long pauses', value: `${m.long_pauses_over_3s}`, unit: 'over 3 seconds' },
    { label: 'Duration', value: formatDuration(m.duration_seconds), unit: 'min:sec' },
  ];
  return (
    <>
      <Card>
        <CardContent className="grid gap-6 pt-6 sm:grid-cols-[auto_1fr]">
          <div className="text-center sm:border-r sm:pr-6">
            <p className="text-sm text-muted-foreground">Overall</p>
            <p className="text-4xl font-semibold tabular-nums text-primary">{overall !== null ? overall.toFixed(1) : '–'}</p>
            <p className="text-xs text-muted-foreground">average of 10 categories, out of 5</p>
          </div>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">{fb.overall_summary}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ListBlock title="Top strengths" items={fb.top_strengths} />
              <ListBlock title="Top priorities" items={fb.top_priorities} />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="gap-1 py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.unit}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">Delivery metrics are measured from the transcript, not judged by the model.</p>
    </>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Score ${score} out of 5`}>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`h-2.5 w-5 rounded-sm ${n <= score ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>
      <span className="w-8 text-sm font-semibold tabular-nums">{score}/5</span>
    </div>
  );
}

function CategoryGroup({
  title,
  items,
  session,
  audienceName,
  onPlay,
}: {
  title: string;
  items: FeedbackCategory[];
  session: SessionDetail;
  audienceName: Map<string, string>;
  onPlay: ((ts: string) => void) | null;
}) {
  const byKey = useMemo(() => new Map(session.categories.map((c) => [c.category_key, c])), [session.categories]);
  const judges = useMemo(() => new Map(session.judges.map((j) => [j.judge_id, j])), [session.judges]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {items.map((c) => (
          <CategoryRow key={c.category_key} item={c} meta={byKey.get(c.category_key)} judges={judges} audienceName={audienceName} onPlay={onPlay} />
        ))}
      </CardContent>
    </Card>
  );
}

function CategoryRow({
  item,
  meta,
  judges,
  audienceName,
  onPlay,
}: {
  item: FeedbackCategory;
  meta: Category | undefined;
  judges: Map<string, JudgeInput>;
  audienceName: Map<string, string>;
  onPlay: ((ts: string) => void) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-3 px-6 py-4 text-left hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{meta?.category_name ?? item.category_key}</p>
          {meta && <p className="text-xs text-muted-foreground">{meta.description}</p>}
        </div>
        <ScoreBar score={item.score} />
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-5 px-6 pb-5 text-sm">
        <section>
          <h5 className="mb-2 font-semibold">Evidence</h5>
          <ul className="space-y-2">
            {item.evidence.map((e, i) => (
              <li key={i} className="flex gap-3">
                {onPlay ? (
                  <button className="flex h-fit items-center gap-1 rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-accent-foreground hover:bg-secondary" onClick={() => onPlay(e.timestamp)} aria-label={`Play from ${e.timestamp}`}>
                    <Play className="h-3 w-3" /> {e.timestamp}
                  </button>
                ) : (
                  <span className="h-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.timestamp}</span>
                )}
                <q className="italic text-muted-foreground">{e.quote}</q>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h5 className="mb-2 font-semibold">Judges&apos; view</h5>
          {item.judges.consensus && (
            <p>
              <span className="font-medium">Consensus: </span>
              {item.judges.consensus}
            </p>
          )}
          {item.judges.disagreements && (
            <p className="mt-1">
              <span className="font-medium">Disagreements: </span>
              {item.judges.disagreements}
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {item.judges.by_judge
              .filter((j) => j.comment)
              .map((j) => {
                const judge = judges.get(j.judge_id);
                return (
                  <li key={j.judge_id} className="rounded-md border-l-2 border-ring bg-muted/40 px-3 py-2">
                    <p className="text-xs font-semibold">
                      {judge?.name || `Judge ${judge?.position ?? ''}`}
                      {judge?.role ? ` · ${judge.role}` : ''}
                    </p>
                    <p>{j.comment}</p>
                    {j.lens_note && <p className="mt-1 text-xs text-muted-foreground">Lens: {j.lens_note}</p>}
                  </li>
                );
              })}
          </ul>
          {!item.judges.consensus && !item.judges.disagreements && item.judges.by_judge.every((j) => !j.comment) && (
            <p className="text-muted-foreground">The judges did not comment on this category.</p>
          )}
        </section>
        {item.audience_notes.length > 0 && (
          <section>
            <h5 className="mb-2 font-semibold">For each audience</h5>
            <ul className="space-y-1">
              {item.audience_notes.map((n) => (
                <li key={n.audience_key}>
                  <span className="font-medium">{audienceName.get(n.audience_key) ?? n.audience_key}: </span>
                  {n.note}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-md bg-accent p-3 text-accent-foreground">
          <h5 className="font-semibold">Try next time</h5>
          <p>{item.improvement}</p>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidePanel({ session, audienceName, onChanged }: { session: SessionDetail; audienceName: Map<string, string>; onChanged: () => void }) {
  const fb = session.feedback!.feedback_json;
  const judges = new Map(session.judges.map((j) => [j.judge_id, j]));
  const lensNotes = fb.categories.flatMap((c) => c.judges.by_judge.filter((j) => j.lens_note).map((j) => ({ ...j, category: c.category_key })));
  const [rating, setRating] = useState<boolean | null>(session.my_rating);
  const [ratingError, setRatingError] = useState<string | null>(null);

  async function rate(useful: boolean) {
    setRating(useful);
    setRatingError(null);
    try {
      await api(`/api/sessions/${session.session_id}/rating`, { method: 'PUT', body: JSON.stringify({ useful }) });
      onChanged();
    } catch (e) {
      setRatingError(e instanceof Error ? e.message : String(e));
    }
  }

  const fitVariant = (r: string) => (r === 'served_well' ? 'bg-success text-success-foreground' : r === 'partly' ? 'bg-warning text-warning-foreground' : 'bg-destructive text-destructive-foreground');

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience fit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {fb.audience_fit.map((a) => (
            <div key={a.audience_key}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{audienceName.get(a.audience_key) ?? a.audience_key}</span>
                <Badge className={fitVariant(a.rating)}>{FIT_LABEL[a.rating] ?? a.rating}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{a.note}</p>
            </div>
          ))}
          {fb.audience_gaps.length > 0 && (
            <p className="text-xs text-muted-foreground">Underserved: {fb.audience_gaps.map((k) => audienceName.get(k) ?? k).join(', ')}</p>
          )}
        </CardContent>
      </Card>
      {lensNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Judge lens notes</CardTitle>
            <CardDescription>Where a judge&apos;s own role shaped their view more than the audience&apos;s needs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {lensNotes.map((n, i) => {
              const j = judges.get(n.judge_id);
              return (
                <p key={i}>
                  <span className="font-medium">{j?.name || `Judge ${j?.position ?? ''}`}</span>
                  {j?.role ? ` (${j.role})` : ''}: {n.lens_note}
                </p>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Card className="no-print">
        <CardHeader>
          <CardTitle className="text-base">Was this useful?</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant={rating === true ? 'default' : 'outline'} size="sm" onClick={() => void rate(true)} aria-pressed={rating === true}>
            <ThumbsUp className="h-4 w-4" /> Yes
          </Button>
          <Button variant={rating === false ? 'default' : 'outline'} size="sm" onClick={() => void rate(false)} aria-pressed={rating === false}>
            <ThumbsDown className="h-4 w-4" /> No
          </Button>
          {ratingError && <p className="text-xs text-destructive">{ratingError}</p>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        AI-generated from transcripts and judges&apos; comments by {session.feedback!.model_name} (prompt {session.feedback!.prompt_version}, depth {session.feedback!.depth_level}). Check the quoted evidence before acting on it.
      </p>
    </aside>
  );
}

interface TranscriptSegment {
  start: number;
  text: string;
}

function parseTranscript(raw: string): TranscriptSegment[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    const segments = data && typeof data === 'object' && 'segments' in data ? data.segments : null;
    if (!Array.isArray(segments)) return null;
    return segments.flatMap((s: unknown) =>
      s && typeof s === 'object' && 'start' in s && 'text' in s && typeof s.text === 'string' ? [{ start: Number(s.start), text: s.text }] : [],
    );
  } catch {
    return null;
  }
}

function TranscriptsDialog({ session }: { session: SessionDetail }) {
  const withTranscripts = session.media.filter((m) => m.transcript_path);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const entries = await Promise.all(
        withTranscripts.map(async (m) => {
          const res = await fetch(`/api/files/files/read?path=${encodeURIComponent(m.transcript_path!)}`);
          if (!res.ok) throw new Error(`Could not load a transcript (${res.status}).`);
          return [m.media_id, await res.text()] as const;
        }),
      );
      setTexts(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const label = (m: SessionDetail['media'][number]) => {
    if (m.role === 'participant') return session.participant_name;
    if (m.role === 'topic') return 'Topic';
    const j = session.judges.find((x) => x.judge_id === m.judge_id);
    return `${j?.name || `Judge ${j?.position ?? ''}`}${j?.role ? ` · ${j.role}` : ''}`;
  };

  return (
    <Dialog onOpenChange={(o) => o && void load()}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={withTranscripts.length === 0}>
          <FileText className="h-4 w-4" /> View transcripts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Transcripts</DialogTitle>
        </DialogHeader>
        {error && <ErrorBlock message={error} />}
        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-6">
            {withTranscripts.map((m) => {
              const raw = texts[m.media_id];
              const segments = raw ? parseTranscript(raw) : null;
              return (
                <section key={m.media_id}>
                  <h4 className="mb-2 font-semibold">{label(m)}</h4>
                  {!raw ? (
                    <Skeleton className="h-16 w-full" />
                  ) : segments ? (
                    <div className="space-y-1 text-sm">
                      {segments.map((s, i) => (
                        <p key={i}>
                          <span className="mr-2 font-mono text-xs text-muted-foreground">{formatDuration(s.start)}</span>
                          {s.text}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm">{raw}</pre>
                  )}
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
