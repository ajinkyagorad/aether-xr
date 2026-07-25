/**
 * Dev-only Vite plugin: POST a PNG data URL to /__shot and it lands on disk.
 *
 * Used to eyeball the renderer during development from a headless context.
 * Never registered in a production build.
 */

import fs from 'node:fs';
import path from 'node:path';

export function capturePlugin(outDir) {
  return {
    name: 'aether-capture',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(outDir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 40e6) req.destroy();
        });
        req.on('end', () => {
          const m = /^data:image\/png;base64,/.exec(body);
          const name = (req.url || '/shot').replace(/^\//, '') || 'shot';
          const file = path.join(outDir, `${name.replace(/[^\w.-]/g, '_')}.png`);
          fs.writeFileSync(file, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
          res.setHeader('content-type', 'text/plain');
          res.end(m ? file : 'wrote (no data-url prefix seen)');
        });
      });
    },
  };
}
