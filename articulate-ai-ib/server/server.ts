import { createApp, files, jobs, lakebase, server, type FilePolicy, WRITE_ACTIONS } from '@databricks/appkit';
import { MAX_MEDIA_BYTES, UPLOAD_CHUNK_BYTES } from '../shared/domain';
import type { AppKitHandle } from './lib/db';
import { registerAdminRoutes } from './routes/admin-routes';
import { registerReferenceRoutes } from './routes/reference-routes';
import { registerSessionRoutes } from './routes/session-routes';
import { registerSettingsRoutes } from './routes/settings-routes';

// Browsers may only write new recordings under raw/; processed audio and transcripts belong to the job.
const mediaPolicy: FilePolicy = (action, resource) => {
  if (!WRITE_ACTIONS.has(action)) return true;
  return action === 'upload' && resource.path.replace(/^\/+/, '').startsWith('raw/');
};

createApp({
  plugins: [
    files({
      // the job writes playback audio as .mp3, which the built-in map serves as octet-stream
      customContentTypes: { '.mp3': 'audio/mpeg' },
      volumes: {
        files: { policy: mediaPolicy, maxUploadSize: UPLOAD_CHUNK_BYTES + 1024 * 1024 },
      },
    }),
    jobs(),
    lakebase(),
    server(),
  ],
  onPluginsReady(appkit) {
    const handle: AppKitHandle = appkit;
    registerReferenceRoutes(handle);
    registerSessionRoutes(handle);
    registerSettingsRoutes(handle);
    registerAdminRoutes(handle);
    console.log(`[articulate] media uploads chunked at ${UPLOAD_CHUNK_BYTES} bytes, max ${MAX_MEDIA_BYTES} bytes per file`);
  },
}).catch(console.error);
