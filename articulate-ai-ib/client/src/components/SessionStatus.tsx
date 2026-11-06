import { Badge } from '@databricks/appkit-ui/react';
import { Check, Loader2 } from 'lucide-react';
import { JOB_STEPS, type SessionSummary } from '../../../shared/domain';

export function StatusBadge({ session }: { session: Pick<SessionSummary, 'status' | 'is_provisional'> }) {
  switch (session.status) {
    case 'complete':
      return session.is_provisional ? (
        <Badge className="bg-warning text-warning-foreground">Provisional categories</Badge>
      ) : (
        <Badge className="bg-success text-success-foreground">Complete</Badge>
      );
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    case 'draft':
      return <Badge variant="outline">Draft</Badge>;
    case 'uploaded':
      return <Badge variant="secondary">Queued</Badge>;
    default:
      return <Badge variant="secondary">Processing</Badge>;
  }
}

export function isRunning(s: Pick<SessionSummary, 'status'>): boolean {
  return s.status === 'uploaded' || s.status === 'processing';
}

export function ProgressTracker({ session }: { session: Pick<SessionSummary, 'status' | 'current_step' | 'status_detail'> }) {
  const currentIndex = JOB_STEPS.findIndex((s) => s.key === session.current_step);
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Processing steps">
        {JOB_STEPS.map((step, i) => {
          const done = session.status === 'complete' || i < currentIndex;
          const active = session.status === 'processing' && i === currentIndex;
          return (
            <li key={step.key} className={`flex items-center gap-1.5 text-sm ${done ? 'text-foreground' : active ? 'font-medium text-primary' : 'text-muted-foreground'}`} aria-current={active ? 'step' : undefined}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${done ? 'border-primary bg-primary text-primary-foreground' : active ? 'border-primary' : ''}`}>
                {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
      {session.status_detail && <p className="text-xs text-muted-foreground">{session.status_detail}</p>}
    </div>
  );
}
