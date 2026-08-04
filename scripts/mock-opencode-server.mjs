import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const KEY_PATH = '/tmp/68hub-opencode-key.pem';
const CERT_PATH = '/tmp/68hub-opencode-cert.pem';
const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_PORT || 8443);
const USE_HTTP = process.env.MOCK_HTTP === '1';

if (!USE_HTTP && (!existsSync(KEY_PATH) || !existsSync(CERT_PATH))) {
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    KEY_PATH,
    '-out',
    CERT_PATH,
    '-days',
    '1',
    '-subj',
    '/CN=opencode.ai',
  ], { stdio: 'inherit' });
}

const workspaceRefs = `
  id: "wrk_test" name: "Test Workspace"
`;

const quotaHtml = `
  <html><body>
    rollingUsage: $R[1] = {usagePercent: 12.5, resetInSec: 3600}
    weeklyUsage: $R[2] = {usagePercent: 80, resetInSec: 604800}
    monthlyUsage: $R[3] = {usagePercent: 34, resetInSec: 2592000}
  </body></html>
`;

function usagePage(page) {
  if (page === 0) {
    return `
      $R[1]={id:"usg_1",model:"gpt-5",provider:"opencode",inputTokens:100,outputTokens:20,cacheReadTokens:5,cacheWrite5mTokens:2,cacheWrite1hTokens:1,cost:300000000,keyID:"key_1",timeCreated:$R[2]=new Date("2026-08-05T00:00:00.000Z")}
      ,$R[3]={id:"usg_2",model:"claude",inputTokens:10,outputTokens:5,cacheReadTokens:0,cacheWrite5mTokens:0,cacheWrite1hTokens:0,cost:1000000,timeCreated:$R[4]=new Date("2026-08-04T00:00:00.000Z")}
    `;
  }
  if (page === 1) {
    return `
      $R[1]={id:"usg_3",model:"gpt-5",inputTokens:8,outputTokens:4,cacheReadTokens:0,cacheWrite5mTokens:0,cacheWrite1hTokens:0,cost:500000,timeCreated:$R[2]=new Date("2026-08-03T00:00:00.000Z")}
    `;
  }
  return '{}';
}

const handler = (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    console.log(`[mock] ${req.method} ${url.pathname}${url.search}`);
    const serverId = url.searchParams.get('id');
    const argsRaw = url.searchParams.get('args');
    let body = '';

    if (url.pathname.startsWith('/workspace/')) {
      body = quotaHtml;
    } else if (serverId === 'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f') {
      body = workspaceRefs;
    } else if (argsRaw) {
      let page = 0;
      try {
        const args = JSON.parse(argsRaw);
        page = Number(args[1] || 0);
      } catch {
        page = 0;
      }
      body = usagePage(page);
    }

    const payload = Buffer.from(body, 'utf8');
    const contentType = url.pathname.startsWith('/workspace/')
      ? 'text/html'
      : 'text/javascript';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': payload.length,
      'Connection': 'close',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(payload);
    console.log(`[mock] -> ${url.pathname} ${payload.length} bytes`);
  };

const server = USE_HTTP
  ? http.createServer(handler)
  : https.createServer(
      { key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH) },
      handler,
    );

server.listen(PORT, HOST, () => {
  console.log(
    `mock opencode.ai listening on ${USE_HTTP ? 'http' : 'https'}://${HOST}:${PORT}`,
  );
});
