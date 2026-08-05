import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'extension/shared/parsers.js'));

const { OpenCodeParser } = globalThis;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const quotaHtml = `
  rollingUsage: $R[1] = {usagePercent: 42.5, resetInSec: 3600}
  weeklyUsage: $R[2] = {usagePercent: 80, resetInSec: 604800}
  monthlyUsage: $R[3] = {usagePercent: 100, resetInSec: 2592000}
`;

const windows = OpenCodeParser.parseQuotaHtml(quotaHtml, new Date('2026-08-05T00:00:00Z'));
assert(windows.length === 3, 'expected three quota windows');
assert(windows[0].used === 42.5, 'rolling quota percent mismatch');
assert(windows[1].used === 80, 'weekly quota percent mismatch');
assert(windows[2].used === 100, 'monthly quota percent mismatch');

const cascaded = OpenCodeParser.applyOpencodeCascade(windows);
assert(cascaded[1].blocked === true, 'weekly should be blocked by monthly');
assert(cascaded[2].blocked === false, 'monthly itself should not be blocked');
assert(OpenCodeParser.opencodeEffectiveRemaining(windows) === 0, 'effective remaining should be zero');

const usageText = `
  $R[1]={id:"usg_1",model:"gpt-5",provider:"opencode",inputTokens:100,outputTokens:20,cacheReadTokens:5,cacheWrite5mTokens:2,cacheWrite1hTokens:1,cost:300000000,keyID:"key_1",timeCreated:$R[2]=new Date("2026-08-05T00:00:00.000Z")}
  ,$R[3]={id:"usg_2",model:"claude",inputTokens:10,outputTokens:5,cacheReadTokens:0,cacheWrite5mTokens:0,cacheWrite1hTokens:0,cost:1000000,timeCreated:$R[4]=new Date("2026-08-04T00:00:00.000Z")}
`;

const records = OpenCodeParser.parseUsageResponse(usageText);
assert(records.length === 2, 'expected two usage records');
assert(records[0].usg_id === 'usg_1', 'usage id mismatch');
assert(records[0].input_tokens === 108, 'input tokens should include cache');
assert(records[0].uncached_input_tokens === 100, 'uncached input tokens mismatch');
assert(records[0].cache_write_tokens === 3, 'cache write tokens mismatch');
assert(records[0].cost_usd === 0.3, 'cost usd mismatch');
assert(records[1].model === 'claude', 'model mismatch');

console.log('extension parser tests passed');
