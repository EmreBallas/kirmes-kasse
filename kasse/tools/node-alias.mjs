// Node-Loader fuer `npm run server` (Plan B ohne Electron, ohne tsx):
// loest die Aliase @core/*, @server/*, @print/* auf src/... auf und ergaenzt bei relativen Importen
// aus .ts-Dateien die fehlende Endung .ts (bzw. /index.ts). Die Typen selbst entfernt Node 24 nativ.
// Aufruf: node --import ./tools/node-alias.mjs src/server/standalone.ts
import { register } from 'node:module'

register('./node-alias-hooks.mjs', import.meta.url)
