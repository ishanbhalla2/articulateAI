import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
} from '@databricks/appkit-ui/react';
import { CheckCircle2 } from 'lucide-react';
import { DEFAULT_LLM_INSTRUCTIONS, DEPTH_LEVELS, INSTRUCTION_PLACEHOLDERS, type AppSettings, type ModelInfo } from '../../../shared/domain';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '../components/States';
import { api, formatDate, useApi } from '../lib/api';

interface SettingsResponse {
  current: AppSettings | null;
  models: ModelInfo[];
  can_edit: boolean;
  admin_group: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  databricks: 'Databricks foundation models',
  vivanti_gateway: 'Vivanti AI gateway',
};

function modelTag(m: ModelInfo): string {
  if (m.accepts_audio && m.accepts_video) return 'Hears tone · sees video';
  if (m.accepts_audio) return 'Hears tone · no video';
  if (m.accepts_image) return 'Works from transcripts · sees video frames';
  return 'Works from transcripts';
}

export function SettingsPage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  if (settings.loading && !settings.data) return <LoadingBlock rows={5} />;
  if (settings.error || !settings.data) return <ErrorBlock message={settings.error ?? 'Could not load settings.'} onRetry={settings.reload} />;
  if (!settings.data.current) return <EmptyBlock title="No settings yet" description="Seed app_settings in Lakebase before using the app." />;
  return <SettingsForm key={settings.data.current.version} data={settings.data} current={settings.data.current} onSaved={settings.reload} />;
}

function SettingsForm({ data, current, onSaved }: { data: SettingsResponse; current: AppSettings; onSaved: () => void }) {
  const navigate = useNavigate();
  const [instructions, setInstructions] = useState(current.llm_instructions);
  const [provider, setProvider] = useState(current.provider);
  const [modelId, setModelId] = useState(current.model_id);
  const [depth, setDepth] = useState(current.depth_level);
  const [directOnly, setDirectOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const readOnly = !data.can_edit;

  const providers = useMemo(() => [...new Set(data.models.filter((m) => m.enabled).map((m) => m.provider))], [data.models]);
  const providerModels = data.models.filter((m) => m.enabled && m.provider === provider);
  const visible = directOnly ? providerModels.filter((m) => m.accepts_audio && m.accepts_video) : providerModels;
  const selected = data.models.find((m) => m.provider === provider && m.model_id === modelId);
  const level = DEPTH_LEVELS[depth - 1];
  const dirty = instructions !== current.llm_instructions || provider !== current.provider || modelId !== current.model_id || depth !== current.depth_level;

  function reset() {
    setInstructions(current.llm_instructions);
    setProvider(current.provider);
    setModelId(current.model_id);
    setDepth(current.depth_level);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ llm_instructions: instructions, provider, model_id: modelId, depth_level: depth }) });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Settings" description="Changes apply to new sessions only. Past feedback keeps the settings it was generated with." />
      {readOnly && (
        <Alert className="mb-6">
          <AlertDescription>You can view these settings. Only members of the &ldquo;{data.admin_group}&rdquo; group can change them.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Instructions to the LLM</CardTitle>
              <CardDescription>
                Placeholders you can use: {INSTRUCTION_PLACEHOLDERS.map((p) => <code key={p} className="mx-0.5 rounded bg-muted px-1 text-xs">{p}</code>)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={12} disabled={readOnly} aria-label="Instructions to the LLM" className="font-mono text-sm" maxLength={20000} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{instructions.length.toLocaleString('en-GB')} characters</span>
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setInstructions(DEFAULT_LLM_INSTRUCTIONS)} disabled={readOnly}>
                  Reset to default
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>LLM model</CardTitle>
              <CardDescription>Audio is always transcribed first, for timestamps and delivery metrics.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="provider">Provider</Label>
                  <Select
                    value={provider}
                    onValueChange={(p) => {
                      setProvider(p);
                      const first = data.models.find((m) => m.enabled && m.provider === p);
                      if (first) setModelId(first.model_id);
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger id="provider" className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PROVIDER_LABEL[p] ?? p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch id="direct" checked={directOnly} onCheckedChange={setDirectOnly} />
                  <Label htmlFor="direct" className="font-normal">
                    Only show models that take audio and video directly
                  </Label>
                </div>
              </div>
              {visible.length === 0 ? (
                <EmptyBlock
                  title="No models match"
                  description={directOnly ? 'None of this provider’s models take audio and video directly. Turn the filter off to see models that work from transcripts.' : 'This provider has no enabled models.'}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Model">
                  {visible.map((m) => {
                    const active = m.model_id === modelId;
                    return (
                      <button
                        key={m.model_id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={readOnly}
                        onClick={() => setModelId(m.model_id)}
                        className={`space-y-2 rounded-lg border p-4 text-left transition-colors disabled:cursor-default ${active ? 'border-ring bg-accent' : 'hover:bg-muted/50'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{m.display_name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{m.model_id}</p>
                          </div>
                          {active && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {m.accepts_text && <Badge variant="outline">Text</Badge>}
                          {m.accepts_image && <Badge variant="outline">Images</Badge>}
                          {m.accepts_audio && <Badge variant="outline">Audio</Badge>}
                          {m.accepts_video && <Badge variant="outline">Video</Badge>}
                        </div>
                        <p className="text-xs font-medium text-primary">{modelTag(m)}</p>
                        {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Speed and cost</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <Slider min={1} max={5} step={1} value={[depth]} onValueChange={([v]) => v && setDepth(v)} disabled={readOnly} aria-label="Analysis depth" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Faster · lower cost</span>
                  <span>Slower · more thorough</span>
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-3">
                  <p className="text-lg font-semibold">
                    {level.level}. {level.name}
                    {level.level === 3 ? ' (default)' : ''}
                  </p>
                  <Badge variant="outline" className="font-mono">
                    {level.cost}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{level.speed}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Analysis</dt>
                  <dd>{level.analysis}</dd>
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd>{level.evidence}</dd>
                  <dt className="text-muted-foreground">Video</dt>
                  <dd>
                    {level.video}
                    {selected && !selected.accepts_video && !selected.accepts_image && level.video !== 'Not analysed' ? ' (not used: this model cannot see video)' : ''}
                  </dd>
                </dl>
              </div>
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => (dirty ? reset() : void navigate(-1))} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving || !dirty || !selected}>
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
              {saved && !dirty && (
                <span className="flex items-center gap-1 text-sm text-success" role="status">
                  <CheckCircle2 className="h-4 w-4" /> Settings saved
                </span>
              )}
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current settings</CardTitle>
              <CardDescription>
                Version {current.version}, saved by {current.updated_by} on {formatDate(current.updated_at)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Provider: </span>
                {PROVIDER_LABEL[current.provider] ?? current.provider}
              </p>
              <p>
                <span className="text-muted-foreground">Model: </span>
                {data.models.find((m) => m.model_id === current.model_id)?.display_name ?? current.model_id}
              </p>
              <p>
                <span className="text-muted-foreground">Depth: </span>
                {current.depth_level}. {DEPTH_LEVELS[current.depth_level - 1]?.name}
              </p>
              {dirty && <p className="text-xs font-medium text-muted-foreground">You have unsaved changes.</p>}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
