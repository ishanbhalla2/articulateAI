import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, Progress, ToggleGroup, ToggleGroupItem } from '@databricks/appkit-ui/react';
import { Circle, FileAudio, FileVideo, Mic, RotateCcw, Square, Upload, Video, X } from 'lucide-react';
import type { MediaRef, MediaRole } from '../../../shared/domain';
import { formatDuration } from '../lib/api';
import { mediaTypeOf, probeDuration, uploadMedia } from '../lib/upload';

export type SlotMedia = Omit<MediaRef, 'role' | 'judge_id'>;

export interface MediaSlot {
  state: 'empty' | 'uploading' | 'ready' | 'error';
  media: SlotMedia | null;
  progress: number;
  error: string | null;
  previewUrl: string | null;
}

export const EMPTY_SLOT: MediaSlot = { state: 'empty', media: null, progress: 0, error: null, previewUrl: null };

interface Props {
  sessionId: string;
  role: MediaRole;
  label: string;
  value: MediaSlot;
  onChange: (next: MediaSlot | ((prev: MediaSlot) => MediaSlot)) => void;
}

export function MediaInput({ sessionId, role, label, value, onChange }: Props) {
  const [mode, setMode] = useState<'upload' | 'live'>(value.media?.source ?? 'upload');

  async function accept(blob: Blob, source: 'upload' | 'live', filename: string | null, knownDuration: number | null) {
    const mime = blob.type || 'application/octet-stream';
    const kind = mediaTypeOf(mime);
    if (!kind) {
      onChange({ ...EMPTY_SLOT, state: 'error', error: 'Choose an audio or video file.' });
      return;
    }
    const mediaId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(blob);
    const duration = knownDuration ?? (await probeDuration(blob, kind));
    onChange({ state: 'uploading', media: null, progress: 0, error: null, previewUrl });
    try {
      const { mediaPath, partCount } = await uploadMedia(blob, sessionId, mediaId, (p) =>
        onChange((prev) => ({ ...prev, progress: p })),
      );
      onChange({
        state: 'ready',
        progress: 1,
        error: null,
        previewUrl,
        media: {
          media_id: mediaId,
          source,
          media_path: mediaPath,
          media_type: kind,
          mime_type: mime,
          original_filename: filename,
          duration_seconds: duration,
          part_count: partCount,
        },
      });
    } catch (err) {
      onChange({ ...EMPTY_SLOT, state: 'error', error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function clear() {
    if (value.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(EMPTY_SLOT);
  }

  if (value.state === 'uploading') {
    return (
      <div className="space-y-2 rounded-md border border-dashed p-4" aria-live="polite">
        <p className="text-sm text-muted-foreground">Uploading {label.toLowerCase()}… {Math.round(value.progress * 100)}%</p>
        <Progress value={value.progress * 100} />
      </div>
    );
  }

  if (value.state === 'ready' && value.media) {
    const m = value.media;
    const Icon = m.media_type === 'video' ? FileVideo : FileAudio;
    return (
      <div className="space-y-3 rounded-md border bg-muted/40 p-3">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.original_filename ?? (m.source === 'live' ? `Live ${m.media_type} recording` : 'Recording')}</p>
            <p className="text-xs text-muted-foreground">
              {m.media_type === 'video' ? 'Video' : 'Audio'} · {formatDuration(m.duration_seconds)}
              {m.mime_type ? ` · ${m.mime_type.split(';')[0]}` : ''}
            </p>
          </div>
          {m.source === 'live' ? (
            <Button variant="outline" size="sm" onClick={clear}>
              <RotateCcw className="h-4 w-4" /> Re-record
            </Button>
          ) : (
            <Button variant="ghost" size="icon" onClick={clear} aria-label={`Remove ${label.toLowerCase()}`}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {value.previewUrl &&
          (m.media_type === 'video' ? (
            <video src={value.previewUrl} controls className="max-h-56 w-full rounded-md bg-black" />
          ) : (
            <audio src={value.previewUrl} controls className="w-full" />
          ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(v) => v && setMode(v === 'live' ? 'live' : 'upload')}
        aria-label={`${label}: upload or record`}
      >
        <ToggleGroupItem value="upload">
          <Upload className="h-4 w-4" /> Upload
        </ToggleGroupItem>
        <ToggleGroupItem value="live">
          <Mic className="h-4 w-4" /> Record live
        </ToggleGroupItem>
      </ToggleGroup>
      {value.state === 'error' && value.error && (
        <Alert variant="destructive">
          <AlertDescription>{value.error}</AlertDescription>
        </Alert>
      )}
      {mode === 'upload' ? (
        <DropZone label={label} role={role} onFile={(f) => void accept(f, 'upload', f.name, null)} />
      ) : (
        <LiveRecorder onRecorded={(blob, seconds) => void accept(blob, 'live', null, seconds)} />
      )}
    </div>
  );
}

function DropZone({ label, role, onFile }: { label: string; role: MediaRole; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition-colors ${over ? 'border-ring bg-accent' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Drop an audio or video file here</p>
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        Browse
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        aria-label={`Choose ${label.toLowerCase()} file (${role})`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

function pickMime(kind: 'audio' | 'video'): string | undefined {
  return (kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES).find((t) => MediaRecorder.isTypeSupported(t));
}

function recorderSupport(): string | null {
  if (!window.isSecureContext) return 'Live recording needs a secure (https) connection.';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    return 'This browser cannot record. Use a recent Chrome, Edge, Firefox or Safari, or upload a file instead.';
  return null;
}

function permissionMessage(err: unknown, kind: 'audio' | 'video'): string {
  const name = err instanceof DOMException ? err.name : '';
  const device = kind === 'video' ? 'camera and microphone' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `Access to the ${device} was blocked. Allow it in your browser's site settings, then try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${device} was found. Connect one and try again.`;
  if (name === 'NotReadableError') return `The ${device} is in use by another application.`;
  return `Could not start recording: ${err instanceof Error ? err.message : String(err)}`;
}

function LiveRecorder({ onRecorded }: { onRecorded: (blob: Blob, seconds: number) => void }) {
  const [kind, setKind] = useState<'audio' | 'video'>('audio');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setError(null);
    const unsupported = recorderSupport();
    if (unsupported) {
      setError(unsupported);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' ? { width: 1280, height: 720 } : false });
    } catch (err) {
      setError(permissionMessage(err, kind));
      return;
    }

    const mimeType = pickMime(kind);
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
      setLevel(Math.min(1, peak / 64));
      setElapsed((Date.now() - startedAt) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    if (kind === 'video' && videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play();
    }

    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      void audioCtx.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      setRecording(false);
      setLevel(0);
      stopRef.current = null;
    };
    recorder.onstop = () => {
      const seconds = (Date.now() - startedAt) / 1000;
      cleanup();
      onRecorded(new Blob(chunks, { type: recorder.mimeType || mimeType || `${kind}/webm` }), seconds);
    };
    stopRef.current = () => recorder.state !== 'inactive' && recorder.stop();
    recorder.start(1000);
    setElapsed(0);
    setRecording(true);
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      {!recording && (
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v === 'video' ? 'video' : 'audio')} aria-label="Record audio or video">
            <ToggleGroupItem value="audio">
              <Mic className="h-4 w-4" /> Audio
            </ToggleGroupItem>
            <ToggleGroupItem value="video">
              <Video className="h-4 w-4" /> Video
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => void start()}>
            <Circle className="h-3 w-3 fill-current" /> Start recording
          </Button>
        </div>
      )}
      <div className={kind === 'video' && recording ? 'relative' : 'hidden'}>
        <video ref={videoRef} muted playsInline className="max-h-56 w-full rounded-md bg-black" />
        <span className="absolute left-2 top-2 rounded bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">REC</span>
      </div>
      {recording && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums" aria-live="off">
            {formatDuration(elapsed)}
          </span>
          {kind === 'audio' && (
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Input level" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
            </div>
          )}
          <Button size="sm" variant="destructive" onClick={() => stopRef.current?.()} className="ml-auto">
            <Square className="h-3 w-3 fill-current" /> Stop
          </Button>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
