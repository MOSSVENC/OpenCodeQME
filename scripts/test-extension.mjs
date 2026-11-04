import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'extension/shared/parsers.js'));
require(path.join(root, 'extension/shared/fetchers.js'));
require(path.join(root, 'extension/shared/history.js'));

const { OpenCodeParser, OpenCodeFetcher, HistoryStore } = globalThis;

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
assert(records[0].provider === 'opencode', 'provider mismatch');
assert(records[0].cost_usd === 3, 'cost usd must use the 1e-8 USD unit');
assert(records[1].model === 'claude', 'model mismatch');

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const snapshot = HistoryStore.aggregateSnapshot([
  {
    usg_id: 'usg_snap_1',
    created_at: `${today}T00:00:00.000Z`,
    model: 'gpt-5',
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.2,
  },
  {
    usg_id: 'usg_snap_2',
    created_at: `${today}T01:00:00.000Z`,
    model: 'claude',
    input_tokens: 20,
    output_tokens: 10,
    cost_usd: 0.1,
  },
  {
    usg_id: 'usg_snap_3',
    created_at: `${yesterday}T01:00:00.000Z`,
    model: 'gpt-5',
    input_tokens: 5,
    output_tokens: 5,
    cost_usd: 0.05,
  },
]);
assert(snapshot.total_records === 3, 'snapshot record count mismatch');
assert(snapshot.today_tokens === 150, 'snapshot today tokens mismatch');
assert(snapshot.today_requests === 2, 'snapshot today requests mismatch');
assert(snapshot.model_stats[0].model === 'gpt-5', 'snapshot model ranking mismatch');

const quotaNow = new Date('2026-11-04T00:00:00.000Z');
const quota = OpenCodeFetcher.__test.normalizeQuotaStatus({
  product: 'go',
  access: {
    meters: {
      fiveHour: {
        usedMicroCents: '600000000',
        limitMicroCents: '1200000000',
        resetsAt: '2026-11-04T05:00:00.000Z',
      },
      week: {
        usedMicroCents: '1500000000',
        limitMicroCents: '3000000000',
        resetsAt: '2026-11-09T00:00:00.000Z',
      },
      month: {
        usedMicroCents: '6000000000',
        limitMicroCents: '6000000000',
        resetsAt: '2026-12-01T00:00:00.000Z',
      },
    },
  },
}, quotaNow);
assert(quota.windows.length === 3, 'new quota API should produce three windows');
assert(quota.windows[0].used === 50, 'five-hour meter percent mismatch');
assert(quota.windows[2].used === 100, 'monthly meter percent mismatch');
assert(quota.windows[0].blocked === true, 'monthly exhaustion should block the rolling window');

const usageSnapshot = OpenCodeFetcher.__test.normalizeUsageSnapshot(
  { totalRequests: '12' },
  [{
    date: '2026-11-04',
    totalCostMicroCents: '250000000',
    totalTokens: '1500',
    totalRequests: '4',
  }],
  [{
    model: 'gpt-5',
    provider: 'opencode-go',
    totalRequests: '4',
    totalInputTokens: '100',
    totalOutputTokens: '50',
    totalCacheReadTokens: '20',
    totalCacheWrite5mTokens: '5',
    totalCacheWrite1hTokens: '5',
    totalCostMicroCents: '250000000',
  }],
  quotaNow,
);
assert(usageSnapshot.total_records === 12, 'console usage request total mismatch');
assert(usageSnapshot.today_tokens === 1500, 'console usage today tokens mismatch');
assert(usageSnapshot.model_stats[0].total_input_tokens === 130, 'console usage input totals mismatch');
assert(usageSnapshot.model_stats[0].total_cost_usd === 2.5, 'console usage cost mismatch');
assert(usageSnapshot.daily_stats[0].cost_usd === 2.5, 'console daily cost mismatch');


const originalFetch = globalThis.fetch;
const apiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  apiCalls.push({ target, headers: init.headers || {} });
  const json = (value) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  if (target.endsWith('/console/api/me/orgs')) {
    return json([{ id: 'org_test', name: 'Test Workspace' }]);
  }
  if (target.includes('/console/api/go/status')) {
    return json({
      product: 'go',
      access: {
        meters: {
          fiveHour: {
            usedMicroCents: '600000000',
            limitMicroCents: '1200000000',
            resetsAt: '2026-11-04T05:00:00.000Z',
          },
          week: {
            usedMicroCents: '1500000000',
            limitMicroCents: '3000000000',
            resetsAt: '2026-11-09T00:00:00.000Z',
          },
          month: {
            usedMicroCents: '3000000000',
            limitMicroCents: '6000000000',
            resetsAt: '2026-12-01T00:00:00.000Z',
          },
        },
      },
    });
  }
  if (target.includes('/console/api/usage/summary')) {
    return json({ totalRequests: '12' });
  }
  if (target.includes('/console/api/usage/cost-by-day')) {
    return json([{
      date: '2026-11-04',
      totalCostMicroCents: '250000000',
      totalTokens: '1500',
      totalRequests: '4',
    }]);
  }
  if (target.includes('/console/api/usage/models')) {
    return json({
      items: [{
        model: 'gpt-5',
        provider: 'opencode-go',
        totalRequests: '4',
        totalInputTokens: '100',
        totalOutputTokens: '50',
        totalCacheReadTokens: '20',
        totalCacheWrite5mTokens: '5',
        totalCacheWrite1hTokens: '5',
        totalCostMicroCents: '250000000',
      }],
      pageInfo: { page: 1, pageSize: 100, total: 1, pageCount: 1 },
    });
  }
  throw new Error(`unexpected fetch: ${target}`);
};

try {
  const account = await OpenCodeFetcher.identifyAccount('Default');
  assert(account.workspace_id === 'org_test', 'console org identification mismatch');
  assert(account.api === 'console-v2', 'console org identification should mark v2');
  const liveQuota = await OpenCodeFetcher.fetchQuota('org_test');
  assert(liveQuota.windows[0].used === 50, 'console quota fetch mismatch');
  const liveUsage = await OpenCodeFetcher.fetchUsageSnapshot('org_test');
  assert(liveUsage.total_records === 12, 'console usage fetch mismatch');
  assert(apiCalls.length === 5, 'unexpected console API request count');
  assert(
    apiCalls.filter((call) => call.target.includes('/console/api/') && !call.target.includes('/me/orgs'))
      .every((call) => call.headers['x-org-id'] === 'org_test'),
    'workspace-scoped console requests must send x-org-id',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('extension parser, history, console API and quota tests passed');
