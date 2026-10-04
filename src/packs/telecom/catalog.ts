// Bronze / Silver / Gold objects and product output ports for ALT_AI_PLATFORM (spec section 5).
import type { SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import { MONTHS, type TelData } from './data';
import { ALARMS, ANALYST_REGIONS, AS_OF, MARKETS, MARKET_TO_REGION, PLANS } from './generators.config';
import { PERIODS } from './queries';

export { GATE6_CHECK };

const cdc = cdcColumns();
const regionAccess = { column: 'REGION' };
const marketAccess = (c: string) => ({ column: c, map: MARKET_TO_REGION });
const RESOLUTION: Record<string, string> = { 'New install': 'INST', 'Broadband repair': 'BBRP', 'Network site repair': 'NWRP' };

export function buildCatalog(d: TelData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const subSample = d.subscribers.slice(0, 400);
  const subByKey = new Map(d.subscribers.map((s) => [s.key, s]));
  const siteByKey = new Map(d.sites.map((s) => [s.key, s]));
  const planKey = new Map<string, number>(PLANS.map((p, i) => [p.code, i + 1]));
  const marketKey = new Map<string, number>(MARKETS.map((m, i) => [m.code, i + 1]));
  const sitesByMarket = new Map<string, TelData['sites']>(MARKETS.map((m) => [m.code, d.sites.filter((s) => s.marketCode === m.code)]));
  const sepInvoices = memo(() => d.invoices.filter((v) => v.month === PERIODS.month));
  const severity = Object.fromEntries(ALARMS.map((a) => [a.code, a.severity]));

  // 300 CDRs from the last day of usage, expanded from the daily aggregates of the first subscribers.
  const cdrs = memo(() => {
    const lastDay = d.usage.filter((u) => u.date === AS_OF).slice(0, 60);
    return lastDay.flatMap((u, i) => {
      const s = subByKey.get(u.subKey)!;
      const site = sitesByMarket.get(s.marketCode)![i % sitesByMarket.get(s.marketCode)!.length];
      return Array.from({ length: 5 }, (_, k) => {
        const type = k < 2 ? 'VOICE' : k < 4 ? 'DATA' : 'SMS';
        return {
          id: `CDR${pad(88_100_000 + i * 5 + k, 10)}`, msisdn: s.msisdn, subId: s.id, ts: ts(AS_OF, 420 + i * 13 + k * 97), type, site: site.id,
          dur: type === 'VOICE' ? Math.round((u.voiceMin * 60) / 2 / Math.max(1, u.callAttempts || 1)) : 0, mb: type === 'DATA' ? round((u.dataGb * 1024) / 2, 1) : 0,
          roaming: u.roamingMb > 0, dropped: type === 'VOICE' && k === 0 && u.droppedCalls > 0,
        };
      });
    });
  });

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'CRM_SUBSCRIBER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Subscriber master CDC from the CRM (Debezium change stream), landed as Apache Iceberg on S3',
      columns: [
        col('SUB_ID', 'VARCHAR(12)', 'CRM subscriber id', { nullable: false }), col('ACCT_NO', 'VARCHAR(12)', 'Billing account number'),
        col('FIRST_NM', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('LAST_NM', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }), col('MSISDN', 'VARCHAR(16)', 'Mobile number (E.164); null for broadband', { tags: ['CPNI'] }),
        col('MKT_CD', 'VARCHAR(3)', 'Market code'), col('PLAN_CD', 'VARCHAR(8)', 'Rate plan code'),
        col('STATUS_CD', 'VARCHAR(2)', 'Status code (AC active, DX disconnected)'), col('ACTIVATION_DT', 'DATE', 'Activation date'), ...cdc,
      ],
      rowCount: 61_408_225, bytes: 7.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:12:41', upstream: ['ext:CRM'],
      rowAccess: marketAccess('MKT_CD'),
      rows: memo(() => withCdc(rng, subSample, (s) => ({
        SUB_ID: rng.chance(0.3) ? `${s.id}  ` : s.id, ACCT_NO: s.accountNo, FIRST_NM: noisy(rng, s.first), LAST_NM: noisy(rng, s.last),
        EMAIL_ADDR: rng.chance(0.3) ? s.email.toUpperCase() : s.email, MSISDN: s.msisdn, MKT_CD: s.marketCode,
        PLAN_CD: rng.chance(0.25) ? s.planCode.toLowerCase() : s.planCode, STATUS_CD: s.status === 'Active' ? 'AC' : 'DX', ACTIVATION_DT: s.activationDate,
      }), '2026-09-01', (s) => ANALYST_REGIONS.includes(s.region))),
    },
    {
      schema: 'RAW_BRONZE', name: 'CRM_SUBSCRIBER_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.SUBSCRIBER and SUBSCRIBER_EVENT', columns: [], rowCount: 2_318, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 06:13:00', upstream: ['RAW_BRONZE.CRM_SUBSCRIBER_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'BSS_INVOICE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Invoice header CDC from BSS billing (rating, invoicing and payments)',
      columns: [
        col('INVOICE_NO', 'VARCHAR(24)', 'Invoice number'), col('ACCT_NO', 'VARCHAR(12)', 'Billing account'), col('BILL_DT', 'DATE', 'Bill date'),
        col('RATED_AMT', 'NUMBER(12,2)', 'Charges computed by the rating engine'), col('BILLED_AMT', 'NUMBER(12,2)', 'Service charges on the invoice'),
        col('ROAM_AMT', 'NUMBER(12,2)', 'Roaming charges'), col('DEVICE_AMT', 'NUMBER(12,2)', 'Device installment'), col('MKT_CD', 'VARCHAR(3)', 'Market code'), ...cdc,
      ],
      rowCount: 318_552_904, bytes: 2.6e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:51:18', upstream: ['ext:BSS billing'],
      rowAccess: marketAccess('MKT_CD'),
      rows: memo(() => withCdc(rng, sepInvoices().slice(0, 300), (v) => ({
        INVOICE_NO: v.id, ACCT_NO: subByKey.get(v.subKey)!.accountNo, BILL_DT: v.date, RATED_AMT: v.rated, BILLED_AMT: v.billed,
        ROAM_AMT: v.roaming, DEVICE_AMT: v.deviceRevenue, MKT_CD: v.marketCode,
      }), '2026-09-01')),
    },
    {
      schema: 'RAW_BRONZE', name: 'CDR_MEDIATION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Call and data detail records from the mediation platform (voice, data, SMS)',
      columns: [
        col('CDR_ID', 'VARCHAR(16)', 'CDR id'), col('MSISDN', 'VARCHAR(16)', 'Mobile number', { tags: ['CPNI'] }), col('EVENT_TS', 'TIMESTAMP_NTZ', 'Event start'),
        col('EVENT_TYPE', 'VARCHAR(6)', 'VOICE / DATA / SMS'), col('DURATION_SEC', 'NUMBER(8)', 'Call duration (s)'), col('VOLUME_MB', 'NUMBER(10,1)', 'Data volume (MB)'),
        col('CELL_ID', 'VARCHAR(10)', 'Serving cell site'), col('ROAMING_FLG', 'VARCHAR(1)', 'Roaming (Y/N)'), col('CALL_RESULT', 'VARCHAR(8)', 'NORMAL / DROPPED'), ...cdc,
      ],
      rowCount: 214_806_331_920, bytes: 9.1e12, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:15:00', upstream: ['ext:CDR mediation'],
      rows: memo(() => withCdc(rng, cdrs(), (c) => ({
        CDR_ID: c.id, MSISDN: c.msisdn, EVENT_TS: c.ts, EVENT_TYPE: c.type, DURATION_SEC: c.dur, VOLUME_MB: c.mb, CELL_ID: c.site,
        ROAMING_FLG: c.roaming ? 'Y' : 'N', CALL_RESULT: c.dropped ? 'DROPPED' : 'NORMAL',
      }), AS_OF)),
    },
    {
      schema: 'RAW_BRONZE', name: 'OSS_NETWORK_EVENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Cell and node alarms from the OSS fault manager',
      columns: [
        col('EVT_ID', 'VARCHAR(16)', 'Alarm id'), col('SITE_ID', 'VARCHAR(10)', 'Cell site'), col('EVT_TS', 'TIMESTAMP_NTZ', 'Raised at'), col('ALARM_CD', 'VARCHAR(16)', 'Alarm code'),
        col('SEVERITY', 'VARCHAR(10)', 'Critical / Major / Minor'), col('CLEARED_TS', 'TIMESTAMP_NTZ', 'Cleared at'), ...cdc,
      ],
      rowCount: 48_117_602, bytes: 5.2e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:14:07', upstream: ['ext:OSS network events'],
      rows: memo(() => withCdc(rng, d.network.filter((n) => n.alarm).slice(-300).reverse(), (n) => {
        const start = 60 + ((n.siteKey * 97) % 1200);
        return { EVT_ID: `ALM-${n.date.replace(/-/g, '')}-${pad(n.siteKey, 4)}`, SITE_ID: noisy(rng, n.siteId), EVT_TS: ts(n.date, start), ALARM_CD: n.alarm, SEVERITY: severity[n.alarm!] ?? 'Minor', CLEARED_TS: ts(n.date, Math.min(1439, start + Math.max(4, n.downtimeMin))) };
      }, '2026-09-20')),
    },
    {
      schema: 'RAW_BRONZE', name: 'FSM_WORK_ORDER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Install and repair work orders from the field service management system',
      columns: [
        col('WO_ID', 'VARCHAR(12)', 'Work order id'), col('WO_TYPE', 'VARCHAR(24)', 'Work order type'), col('SITE_ID', 'VARCHAR(10)', 'Cell site (network repairs)'),
        col('ACCT_NO', 'VARCHAR(12)', 'Account (home installs and repairs)'), col('MKT_CD', 'VARCHAR(3)', 'Market code'), col('OPENED_TS', 'TIMESTAMP_NTZ', 'Opened'),
        col('CLOSED_TS', 'TIMESTAMP_NTZ', 'Closed'), col('RESOLUTION_CD', 'VARCHAR(8)', 'Resolution code'), col('VISIT_NO', 'NUMBER(2)', 'Visit number'), ...cdc,
      ],
      rowCount: 4_906_118, bytes: 6.3e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:40:00', upstream: ['ext:Field service'],
      rowAccess: marketAccess('MKT_CD'),
      rows: memo(() => withCdc(rng, d.workOrders.slice(-300).reverse(), (w) => {
        const open = 420 + ((w.key * 53) % 600);
        return {
          WO_ID: w.id, WO_TYPE: noisy(rng, w.type), SITE_ID: w.siteId, ACCT_NO: w.subKey ? subByKey.get(w.subKey)!.accountNo : null, MKT_CD: w.marketCode,
          OPENED_TS: ts(w.opened, open), CLOSED_TS: ts(addDays(w.opened, Math.floor((open + w.hours * 60) / 1440)), (open + w.hours * 60) % 1440),
          RESOLUTION_CD: `${RESOLUTION[w.type]}-${w.ftf ? 'FX' : 'RV'}`, VISIT_NO: w.repeat ? 2 : 1,
        };
      }, '2026-09-15')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'SUBSCRIBER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 subscriber entity (one row per subscriber version)',
      columns: [
        col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber identifier (from SUB_ID, trimmed)', { nullable: false, termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('MSISDN', 'VARCHAR(16)', 'Mobile number (E.164)', { tags: ['CPNI'], termId: 'T-019' }),
        col('MARKET_CODE', 'VARCHAR(3)', 'Market code'), col('PLAN_CODE', 'VARCHAR(8)', 'Rate plan', { termId: 'T-012', tags: ['CDE'] }),
        col('SEGMENT', 'VARCHAR(10)', 'Postpaid / Prepaid / Broadband'), col('STATUS', 'VARCHAR(12)', 'Active / Disconnected', { termId: 'T-002' }),
        col('ACTIVATION_DATE', 'DATE', 'Activation date'), col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 13_284_906, bytes: 1.6e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:28:12', upstream: ['RAW_BRONZE.CRM_SUBSCRIBER_CDC_STRM'],
      rowAccess: marketAccess('MARKET_CODE'),
      rows: memo(() => subSample.flatMap((s) => {
        const cur = { SUBSCRIBER_ID: s.id, FIRST_NAME: s.first, LAST_NAME: s.last, EMAIL: s.email, MSISDN: s.msisdn, MARKET_CODE: s.marketCode, PLAN_CODE: s.planCode, SEGMENT: s.segment, STATUS: s.status, ACTIVATION_DATE: s.activationDate };
        return s.priorPlanCode
          ? [{ ...cur, PLAN_CODE: s.priorPlanCode, EFFECTIVE_FROM: s.activationDate, EFFECTIVE_TO: addDays(s.planChangedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: s.planChangedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: s.activationDate, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'INVOICE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 2,
      comment: 'Typed invoices with rated and billed amounts',
      columns: [
        col('INVOICE_ID', 'VARCHAR(24)', 'Invoice id'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber', { termId: 'T-001' }), col('INVOICE_DATE', 'DATE', 'Invoice date'),
        col('RATED_AMOUNT', 'NUMBER(12,2)', 'Rated charges', { termId: 'T-018' }), col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Billed service charges', { termId: 'T-010' }),
        col('ROAMING_AMOUNT', 'NUMBER(12,2)', 'Roaming charges', { termId: 'T-028' }), col('DEVICE_AMOUNT', 'NUMBER(12,2)', 'Device installment'), col('MARKET_CODE', 'VARCHAR(3)', 'Market code'),
      ],
      rowCount: 301_448_117, bytes: 1.8e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:58:40', upstream: ['RAW_BRONZE.BSS_INVOICE_CDC'],
      rowAccess: marketAccess('MARKET_CODE'),
      rows: memo(() => sepInvoices().slice(0, 300).map((v) => ({ INVOICE_ID: v.id, SUBSCRIBER_ID: v.subId, INVOICE_DATE: v.date, RATED_AMOUNT: v.rated, BILLED_AMOUNT: v.billed, ROAMING_AMOUNT: v.roaming, DEVICE_AMOUNT: v.deviceRevenue, MARKET_CODE: v.marketCode }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'USAGE_EVENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 3,
      comment: 'Deduplicated, typed usage events (CDRs) joined to the subscriber',
      columns: [
        col('EVENT_ID', 'VARCHAR(16)', 'CDR id'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber', { termId: 'T-001' }), col('MSISDN', 'VARCHAR(16)', 'Mobile number', { tags: ['CPNI'], termId: 'T-019' }),
        col('EVENT_TS', 'TIMESTAMP_NTZ', 'Event start'), col('EVENT_TYPE', 'VARCHAR(6)', 'VOICE / DATA / SMS'), col('DURATION_SEC', 'NUMBER(8)', 'Call duration (s)'),
        col('VOLUME_MB', 'NUMBER(10,1)', 'Data volume (MB)', { termId: 'T-011' }), col('SITE_ID', 'VARCHAR(10)', 'Serving cell site', { termId: 'T-016' }),
        col('IS_ROAMING', 'BOOLEAN', 'Roaming event'), col('IS_DROPPED', 'BOOLEAN', 'Call dropped', { termId: 'T-013' }),
      ],
      rowCount: 205_118_446_004, bytes: 4.4e12, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:30:02', upstream: ['RAW_BRONZE.CDR_MEDIATION_CDC'],
      rows: memo(() => cdrs().map((c) => ({ EVENT_ID: c.id, SUBSCRIBER_ID: c.subId, MSISDN: c.msisdn, EVENT_TS: c.ts, EVENT_TYPE: c.type, DURATION_SEC: c.dur, VOLUME_MB: c.mb, SITE_ID: c.site, IS_ROAMING: c.roaming, IS_DROPPED: c.dropped }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'NETWORK_EVENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 4,
      comment: 'Cleansed site alarms with outage minutes and region',
      columns: [
        col('EVENT_ID', 'VARCHAR(16)', 'Alarm id'), col('SITE_ID', 'VARCHAR(10)', 'Cell site', { termId: 'T-016' }), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }),
        col('EVENT_DATE', 'DATE', 'Date'), col('ALARM_CODE', 'VARCHAR(16)', 'Alarm code'), col('SEVERITY', 'VARCHAR(10)', 'Severity'),
        col('OUTAGE_MIN', 'NUMBER(6)', 'Service-affecting minutes', { termId: 'T-014' }),
      ],
      rowCount: 46_880_115, bytes: 3.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:14:55', upstream: ['RAW_BRONZE.OSS_NETWORK_EVENT_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.network.filter((n) => n.alarm).reverse().map((n) => ({ EVENT_ID: `ALM-${n.date.replace(/-/g, '')}-${pad(n.siteKey, 4)}`, SITE_ID: n.siteId, REGION: n.region, EVENT_DATE: n.date, ALARM_CODE: n.alarm, SEVERITY: severity[n.alarm!] ?? 'Minor', OUTAGE_MIN: n.downtimeMin }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'WORK_ORDER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Typed work orders with resolution time and first-time-fix flag',
      columns: [
        col('WORK_ORDER_ID', 'VARCHAR(12)', 'Work order id'), col('WORK_ORDER_TYPE', 'VARCHAR(24)', 'New install / Broadband repair / Network site repair', { termId: 'T-031' }),
        col('SITE_ID', 'VARCHAR(10)', 'Cell site'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }),
        col('OPENED_DATE', 'DATE', 'Opened'), col('HOURS_TO_RESOLVE', 'NUMBER(6,1)', 'Hours from open to close', { termId: 'T-031' }),
        col('FIRST_TIME_FIX', 'BOOLEAN', 'Resolved on the first visit', { termId: 'T-021', tags: ['CDE'] }), col('VISIT_COUNT', 'NUMBER(2)', 'Visits'),
      ],
      rowCount: 4_811_402, bytes: 4.2e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:45:00', upstream: ['RAW_BRONZE.FSM_WORK_ORDER_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.workOrders.slice().reverse().map((w) => ({ WORK_ORDER_ID: w.id, WORK_ORDER_TYPE: w.type, SITE_ID: w.siteId, SUBSCRIBER_ID: w.subKey ? subByKey.get(w.subKey)!.id : null, REGION: w.region, OPENED_DATE: w.opened, HOURS_TO_RESOLVE: w.hours, FIRST_TIME_FIX: w.ftf, VISIT_COUNT: w.repeat ? 2 : 1 }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SUBSCRIBER_EVENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 6,
      comment: 'Subscriber lifecycle events: activations, plan migrations and disconnects with reason',
      columns: [
        col('EVENT_ID', 'VARCHAR(16)', 'Event id'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber', { termId: 'T-001' }), col('EVENT_TYPE', 'VARCHAR(12)', 'ACTIVATION / PLAN_CHANGE / DISCONNECT'),
        col('EVENT_DATE', 'DATE', 'Event date'), col('DISCONNECT_REASON', 'VARCHAR(12)', 'VOLUNTARY / PORT_OUT / INVOLUNTARY', { termId: 'T-025' }),
        col('IS_PORT_OUT', 'BOOLEAN', 'Number ported to another carrier', { termId: 'T-005' }), col('IS_PLAN_MIGRATION', 'BOOLEAN', 'Plan change, not a disconnect', { termId: 'T-006' }),
        col('FROM_PLAN', 'VARCHAR(8)', 'Previous plan'), col('TO_PLAN', 'VARCHAR(8)', 'New plan'), col('MARKET_CODE', 'VARCHAR(3)', 'Market code'),
      ],
      rowCount: 9_402_771, bytes: 6.8e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:29:10', upstream: ['RAW_BRONZE.CRM_SUBSCRIBER_CDC_STRM'],
      rowAccess: marketAccess('MARKET_CODE'),
      rows: memo(() => {
        const ev = d.subscribers.flatMap((s) => {
          const out: Record<string, string | boolean | null>[] = [];
          if (s.activationDate >= '2026-01-01') out.push({ EVENT_TYPE: 'ACTIVATION', EVENT_DATE: s.activationDate, DISCONNECT_REASON: null, IS_PORT_OUT: false, IS_PLAN_MIGRATION: false, FROM_PLAN: null, TO_PLAN: s.planCode });
          if (s.priorPlanCode) out.push({ EVENT_TYPE: 'PLAN_CHANGE', EVENT_DATE: s.planChangedOn!, DISCONNECT_REASON: null, IS_PORT_OUT: false, IS_PLAN_MIGRATION: true, FROM_PLAN: s.priorPlanCode, TO_PLAN: s.planCode });
          if (s.status === 'Disconnected') out.push({ EVENT_TYPE: 'DISCONNECT', EVENT_DATE: `${MONTHS[s.lastMonthIdx + 1]}-${pad(1 + (s.key % 27))}`, DISCONNECT_REASON: s.disconnectReason!.toUpperCase().replace('-', '_'), IS_PORT_OUT: s.disconnectReason === 'Port-out', IS_PLAN_MIGRATION: false, FROM_PLAN: s.planCode, TO_PLAN: null });
          return out.map((e): Record<string, string | boolean | null> => ({ ...e, SUBSCRIBER_ID: s.id, MARKET_CODE: s.marketCode }));
        });
        ev.sort((a, b) => (String(a.EVENT_DATE) < String(b.EVENT_DATE) ? 1 : -1));
        return ev.map((e, i) => ({ EVENT_ID: `SEV-${pad(5_000_000 + i, 8)}`, SUBSCRIBER_ID: e.SUBSCRIBER_ID, EVENT_TYPE: e.EVENT_TYPE, EVENT_DATE: e.EVENT_DATE, DISCONNECT_REASON: e.DISCONNECT_REASON, IS_PORT_OUT: e.IS_PORT_OUT, IS_PLAN_MIGRATION: e.IS_PLAN_MIGRATION, FROM_PLAN: e.FROM_PLAN, TO_PLAN: e.TO_PLAN, MARKET_CODE: e.MARKET_CODE }));
      }),
    },
  ];

  const allDates = dateRange('2025-10-01', AS_OF);
  const latestInv = memo(() => {
    const m = new Map<number, { sum: number; n: number }>();
    for (const v of d.invoices) if (PERIODS.quarter.months.includes(v.month)) { const c = m.get(v.subKey) ?? { sum: 0, n: 0 }; c.sum += v.billed; c.n += 1; m.set(v.subKey, c); }
    return m;
  });
  const usage30 = memo(() => {
    const m = new Map<number, { gb: number; dropped: number }>();
    for (const u of d.usage) { const c = m.get(u.subKey) ?? { gb: 0, dropped: 0 }; c.gb += u.dataGb; c.dropped += u.droppedCalls; m.set(u.subKey, c); }
    return m;
  });
  const sepBilled = memo(() => new Set(sepInvoices().map((v) => v.subKey)));

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_SUBSCRIBER', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed subscriber dimension (current version)',
      columns: [
        col('SUBSCRIBER_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber id', { termId: 'T-001', tags: ['CDE'] }),
        col('SUBSCRIBER_NAME', 'VARCHAR(80)', 'Subscriber name', { tags: ['PII'] }), col('EMAIL', 'VARCHAR(120)', 'Contact email', { tags: ['PII'] }),
        col('MSISDN', 'VARCHAR(16)', 'Mobile number (E.164)', { tags: ['CPNI'], termId: 'T-019', maskPendingFix: GATE6_CHECK }),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('MARKET', 'VARCHAR(30)', 'Market'),
        col('PLAN_CODE', 'VARCHAR(8)', 'Rate plan', { termId: 'T-012', tags: ['CDE'] }), col('SEGMENT', 'VARCHAR(10)', 'Postpaid / Prepaid / Broadband'),
        col('STATUS', 'VARCHAR(12)', 'Active / Disconnected', { termId: 'T-002' }), col('TENURE_MONTHS', 'NUMBER(4)', 'Months since activation'),
        col('OUT_OF_CONTRACT', 'BOOLEAN', 'No device or term commitment remaining'), col('AUTOPAY', 'BOOLEAN', 'Enrolled in autopay', { termId: 'T-027' }),
        col('DEVICE_MODEL', 'VARCHAR(30)', 'Current handset'), col('CHURN_PROPENSITY', 'NUMBER(3)', 'Model score 0–100', { termId: 'T-020' }),
      ],
      rowCount: 11_900_000, bytes: 1.3e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:31:00', upstream: ['CURATED_SILVER.SUBSCRIBER'], rowAccess: regionAccess,
      rows: memo(() => d.subscribers.map((s) => ({
        SUBSCRIBER_KEY: s.key, SUBSCRIBER_ID: s.id, SUBSCRIBER_NAME: `${s.first} ${s.last}`, EMAIL: s.email, MSISDN: s.msisdn, REGION: s.region, MARKET: s.market,
        PLAN_CODE: s.planCode, SEGMENT: s.segment, STATUS: s.status, TENURE_MONTHS: s.tenureMonths, OUT_OF_CONTRACT: s.outOfContract, AUTOPAY: s.autopay,
        DEVICE_MODEL: s.deviceModel, CHURN_PROPENSITY: s.churnPropensity,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PLAN', layer: 'gold', type: 'TABLE', order: 2, comment: 'Rate plans (mobile postpaid, prepaid and fiber broadband)',
      columns: [col('PLAN_KEY', 'NUMBER', 'Surrogate key'), col('PLAN_CODE', 'VARCHAR(8)', 'Plan code', { termId: 'T-012', tags: ['CDE'] }), col('PLAN_NAME', 'VARCHAR(30)', 'Plan name'), col('SEGMENT', 'VARCHAR(10)', 'Postpaid / Prepaid / Broadband'), col('LINE_OF_BUSINESS', 'VARCHAR(10)', 'Mobile / Broadband'), col('LIST_PRICE', 'NUMBER(8,2)', 'Monthly list price (USD)'), col('DATA_ALLOWANCE_GB', 'NUMBER(5)', 'High-speed data allowance (0 = n/a)')],
      rowCount: PLANS.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-01 02:00:00', upstream: ['CURATED_SILVER.SUBSCRIBER'],
      rows: memo(() => PLANS.map((p, i) => ({ PLAN_KEY: i + 1, PLAN_CODE: p.code, PLAN_NAME: p.name, SEGMENT: p.segment, LINE_OF_BUSINESS: p.lob, LIST_PRICE: p.price, DATA_ALLOWANCE_GB: p.code.startsWith('U') ? 0 : p.dataGb }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_MARKET', layer: 'gold', type: 'TABLE', order: 3, comment: 'Markets and the region each rolls up to',
      columns: [col('MARKET_KEY', 'NUMBER', 'Surrogate key'), col('MARKET_CODE', 'VARCHAR(3)', 'Market code'), col('MARKET_NAME', 'VARCHAR(30)', 'Market'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003', tags: ['CDE'] })],
      rowCount: MARKETS.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-07-01 02:00:00', upstream: ['CURATED_SILVER.SUBSCRIBER'], rowAccess: regionAccess,
      rows: memo(() => MARKETS.map((m, i) => ({ MARKET_KEY: i + 1, MARKET_CODE: m.code, MARKET_NAME: m.name, REGION: m.region }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CELL_SITE', layer: 'gold', type: 'TABLE', order: 4, comment: 'Cell sites with market, region, technology and vendor',
      columns: [col('SITE_KEY', 'NUMBER', 'Surrogate key'), col('SITE_ID', 'VARCHAR(10)', 'Site id', { termId: 'T-016', tags: ['CDE'] }), col('SITE_NAME', 'VARCHAR(40)', 'Site name'), col('MARKET', 'VARCHAR(30)', 'Market'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('TECHNOLOGY', 'VARCHAR(4)', '5G / LTE'), col('SITE_TYPE', 'VARCHAR(12)', 'Macro / Small cell'), col('VENDOR', 'VARCHAR(30)', 'RAN vendor')],
      rowCount: 15_600, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.NETWORK_EVENT'], rowAccess: regionAccess,
      rows: memo(() => d.sites.map((s) => ({ SITE_KEY: s.key, SITE_ID: s.id, SITE_NAME: s.name, MARKET: s.market, REGION: s.region, TECHNOLOGY: s.technology, SITE_TYPE: s.siteType, VENDOR: s.vendor }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 5, comment: 'Calendar with months and fiscal quarters (FY = calendar year)',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('MONTH', 'VARCHAR(7)', 'yyyy-mm'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_WEEKEND', 'BOOLEAN', 'Saturday or Sunday')],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => { const dow = new Date(`${x}T00:00:00Z`).getUTCDay(); return { DATE_KEY: dateKey(x), CALENDAR_DATE: x, MONTH: x.slice(0, 7), FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_WEEKEND: dow === 0 || dow === 6 }; })),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SUBSCRIBER_MONTHLY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6, comment: 'Subscriber base movements by month, market and plan (gross adds, disconnects, port-outs, migrations)',
      columns: [
        col('MONTH_KEY', 'NUMBER(8)', 'First day of month (yyyymmdd)'), col('MARKET_KEY', 'NUMBER', 'Market'), col('PLAN_KEY', 'NUMBER', 'Plan'),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('SEGMENT', 'VARCHAR(10)', 'Postpaid / Prepaid / Broadband'),
        col('OPENING_BASE', 'NUMBER(10)', 'Subscribers at start of month', { termId: 'T-004', tags: ['CDE'] }), col('GROSS_ADDS', 'NUMBER(8)', 'New connections', { termId: 'T-008' }),
        col('VOLUNTARY_DISCONNECTS', 'NUMBER(8)', 'Customer-initiated disconnects (not ported)', { termId: 'T-025', tags: ['CDE'] }),
        col('PORT_OUTS', 'NUMBER(8)', 'Numbers ported to another carrier', { termId: 'T-005', tags: ['CDE'] }),
        col('INVOLUNTARY_DISCONNECTS', 'NUMBER(8)', 'Non-pay and fraud disconnects'),
        col('MIGRATIONS_IN', 'NUMBER(8)', 'Plan migrations into this plan', { termId: 'T-006' }), col('MIGRATIONS_OUT', 'NUMBER(8)', 'Plan migrations out of this plan', { termId: 'T-006', tags: ['CDE'] }),
        col('CLOSING_BASE', 'NUMBER(10)', 'Subscribers at end of month'),
      ],
      rowCount: 52_416, bytes: 4.1e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:40:12', upstream: ['CURATED_SILVER.SUBSCRIBER_EVENT', 'CONFORMED_GOLD.DIM_PLAN', 'CONFORMED_GOLD.DIM_MARKET'], rowAccess: regionAccess,
      rows: memo(() => d.base.slice().reverse().map((r) => ({
        MONTH_KEY: dateKey(`${r.month}-01`), MARKET_KEY: marketKey.get(r.marketCode)!, PLAN_KEY: planKey.get(r.planCode)!, REGION: r.region, SEGMENT: r.segment,
        OPENING_BASE: r.opening, GROSS_ADDS: r.grossAdds, VOLUNTARY_DISCONNECTS: r.voluntary, PORT_OUTS: r.portOuts, INVOLUNTARY_DISCONNECTS: r.involuntary,
        MIGRATIONS_IN: r.migIn, MIGRATIONS_OUT: r.migOut, CLOSING_BASE: r.closing,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_BILLING', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 7, comment: 'Invoice fact: rated vs billed charges, revenue, cost and device subsidy',
      columns: [
        col('INVOICE_KEY', 'NUMBER', 'Invoice'), col('SUBSCRIBER_KEY', 'NUMBER', 'Subscriber'), col('PLAN_KEY', 'NUMBER', 'Plan'), col('DATE_KEY', 'NUMBER(8)', 'Invoice date'),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }),
        col('RATED_AMOUNT', 'NUMBER(12,2)', 'Charges computed by the rating engine', { termId: 'T-018', tags: ['CDE'] }),
        col('LEAKAGE_AMOUNT', 'NUMBER(12,2)', 'Rated but not billed', { termId: 'T-017', tags: ['CDE'] }),
        col('SERVICE_REVENUE', 'NUMBER(12,2)', 'Billed service revenue (plan, overage, roaming)', { termId: 'T-010', tags: ['CDE'] }),
        col('ROAMING_REVENUE', 'NUMBER(12,2)', 'Retail roaming revenue', { termId: 'T-028' }), col('DEVICE_REVENUE', 'NUMBER(12,2)', 'Device installment revenue'),
        col('COST_OF_SERVICE', 'NUMBER(12,2)', 'Network, interconnect and support cost allocation', { termId: 'T-022', tags: ['CDE'] }),
        col('DEVICE_SUBSIDY', 'NUMBER(12,2)', 'Monthly amortised device subsidy', { termId: 'T-023' }),
      ],
      rowCount: 301_448_117, bytes: 1.5e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:04:51', upstream: ['CURATED_SILVER.INVOICE', 'CONFORMED_GOLD.DIM_SUBSCRIBER'], rowAccess: regionAccess,
      rows: memo(() => d.invoices.slice().reverse().map((v) => ({
        INVOICE_KEY: v.key, SUBSCRIBER_KEY: v.subKey, PLAN_KEY: planKey.get(v.planCode)!, DATE_KEY: dateKey(v.date), REGION: v.region, RATED_AMOUNT: v.rated, LEAKAGE_AMOUNT: v.leakage,
        SERVICE_REVENUE: v.billed, ROAMING_REVENUE: v.roaming, DEVICE_REVENUE: v.deviceRevenue, COST_OF_SERVICE: v.costOfService, DEVICE_SUBSIDY: v.deviceSubsidy,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_DAILY_USAGE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 8, comment: 'Daily usage per mobile subscriber, aggregated from CDRs',
      columns: [
        col('DATE_KEY', 'NUMBER(8)', 'Date'), col('SUBSCRIBER_KEY', 'NUMBER', 'Subscriber'), col('PLAN_KEY', 'NUMBER', 'Plan'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }),
        col('DATA_GB', 'NUMBER(10,3)', 'Data used (GB)', { termId: 'T-011' }), col('VOICE_MIN', 'NUMBER(8,1)', 'Voice minutes of use', { termId: 'T-026' }), col('SMS_COUNT', 'NUMBER(6)', 'Messages sent'),
        col('ROAMING_MB', 'NUMBER(8)', 'Data used while roaming (MB)', { termId: 'T-028' }), col('CALL_ATTEMPTS', 'NUMBER(6)', 'Call attempts'), col('DROPPED_CALLS', 'NUMBER(4)', 'Dropped calls', { termId: 'T-013' }),
      ],
      rowCount: 294_120_000, bytes: 1.1e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:33:12', upstream: ['CURATED_SILVER.USAGE_EVENT', 'CONFORMED_GOLD.DIM_SUBSCRIBER'], rowAccess: regionAccess,
      rows: memo(() => d.usage.slice().reverse().map((u) => ({ DATE_KEY: dateKey(u.date), SUBSCRIBER_KEY: u.subKey, PLAN_KEY: planKey.get(u.planCode)!, REGION: u.region, DATA_GB: u.dataGb, VOICE_MIN: u.voiceMin, SMS_COUNT: u.sms, ROAMING_MB: u.roamingMb, CALL_ATTEMPTS: u.callAttempts, DROPPED_CALLS: u.droppedCalls }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_NETWORK_DAILY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 9, comment: 'Daily network KPIs per cell site (OSS counters and alarms)',
      columns: [
        col('DATE_KEY', 'NUMBER(8)', 'Date'), col('SITE_KEY', 'NUMBER', 'Cell site'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('CALL_ATTEMPTS', 'NUMBER(10)', 'Call attempts'),
        col('DROPPED_CALLS', 'NUMBER(8)', 'Dropped calls', { termId: 'T-013', tags: ['CDE'] }), col('SETUP_FAILURES', 'NUMBER(8)', 'Call setup failures', { termId: 'T-015' }),
        col('DOWNTIME_MIN', 'NUMBER(6)', 'Service-affecting downtime (minutes)', { termId: 'T-014', tags: ['CDE'] }), col('DATA_TB', 'NUMBER(10,3)', 'Data carried (TB)'),
        col('AVG_THROUGHPUT_MBPS', 'NUMBER(6,1)', 'Average user downlink throughput', { termId: 'T-030' }),
      ],
      rowCount: 4_258_800, bytes: 3.4e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:00', upstream: ['CURATED_SILVER.NETWORK_EVENT', 'CONFORMED_GOLD.DIM_CELL_SITE'], rowAccess: regionAccess,
      rows: memo(() => d.network.slice().reverse().map((n) => ({ DATE_KEY: dateKey(n.date), SITE_KEY: n.siteKey, REGION: n.region, CALL_ATTEMPTS: n.attempts, DROPPED_CALLS: n.dropped, SETUP_FAILURES: n.setupFail, DOWNTIME_MIN: n.downtimeMin, DATA_TB: n.dataTb, AVG_THROUGHPUT_MBPS: n.throughput }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_WORK_ORDER', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 10, comment: 'Field service work orders: installs, broadband and network site repairs',
      columns: [
        col('WORK_ORDER_KEY', 'NUMBER', 'Work order'), col('DATE_KEY', 'NUMBER(8)', 'Opened date'), col('SITE_KEY', 'NUMBER', 'Cell site (network repairs)'), col('SUBSCRIBER_KEY', 'NUMBER', 'Subscriber (home visits)'),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('WORK_ORDER_TYPE', 'VARCHAR(24)', 'Work order type', { termId: 'T-031' }),
        col('HOURS_TO_RESOLVE', 'NUMBER(6,1)', 'Hours from open to close', { termId: 'T-031' }), col('FIRST_TIME_FIX', 'BOOLEAN', 'Resolved on the first visit', { termId: 'T-021', tags: ['CDE'] }), col('REPEAT_VISIT', 'BOOLEAN', 'Needed a second visit'),
      ],
      rowCount: 4_811_402, bytes: 2.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:50:00', upstream: ['CURATED_SILVER.WORK_ORDER', 'CONFORMED_GOLD.DIM_CELL_SITE'], rowAccess: regionAccess,
      rows: memo(() => d.workOrders.slice().reverse().map((w) => ({ WORK_ORDER_KEY: w.key, DATE_KEY: dateKey(w.opened), SITE_KEY: w.siteKey, SUBSCRIBER_KEY: w.subKey, REGION: w.region, WORK_ORDER_TYPE: w.type, HOURS_TO_RESOLVE: w.hours, FIRST_TIME_FIX: w.ftf, REPEAT_VISIT: w.repeat }))),
    },
  ];

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SUBSCRIBER_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Subscriber 360',
      columns: [
        col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber id', { termId: 'T-001', tags: ['CDE'] }), col('SUBSCRIBER_NAME', 'VARCHAR(80)', 'Subscriber name', { tags: ['PII'] }),
        col('MSISDN', 'VARCHAR(16)', 'Mobile number', { tags: ['CPNI'], termId: 'T-019' }), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003', tags: ['CDE'] }),
        col('MARKET', 'VARCHAR(30)', 'Market'), col('PLAN_NAME', 'VARCHAR(30)', 'Rate plan', { termId: 'T-012' }), col('SEGMENT', 'VARCHAR(10)', 'Postpaid / Prepaid / Broadband'),
        col('IS_ACTIVE', 'BOOLEAN', 'Active subscriber (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('AUTOPAY', 'BOOLEAN', 'Autopay enrolled', { termId: 'T-027' }),
        col('TENURE_MONTHS', 'NUMBER(4)', 'Tenure'), col('OUT_OF_CONTRACT', 'BOOLEAN', 'Out of contract'), col('CHURN_PROPENSITY', 'NUMBER(3)', 'Churn propensity score', { termId: 'T-020' }),
        col('ARPU_Q3', 'NUMBER(8,2)', 'Average monthly service revenue, Q3 2026', { termId: 'T-009' }), col('DATA_GB_30D', 'NUMBER(8,2)', 'Data used, last 30 days (GB)', { termId: 'T-011' }),
        col('DROPPED_CALLS_30D', 'NUMBER(4)', 'Dropped calls, last 30 days', { termId: 'T-013' }),
      ],
      rowCount: 11_900_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:00:00', upstream: ['CONFORMED_GOLD.DIM_SUBSCRIBER', 'CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE'], rowAccess: regionAccess,
      rows: memo(() => d.subscribers.map((s) => {
        const q = latestInv().get(s.key);
        const u = usage30().get(s.key);
        return {
          SUBSCRIBER_ID: s.id, SUBSCRIBER_NAME: `${s.first} ${s.last}`, MSISDN: s.msisdn, REGION: s.region, MARKET: s.market, PLAN_NAME: s.planName, SEGMENT: s.segment,
          IS_ACTIVE: s.status === 'Active' && sepBilled().has(s.key), AUTOPAY: s.autopay, TENURE_MONTHS: s.tenureMonths, OUT_OF_CONTRACT: s.outOfContract,
          CHURN_PROPENSITY: s.churnPropensity, ARPU_Q3: q ? round(q.sum / q.n, 2) : 0, DATA_GB_30D: round(u?.gb ?? 0, 2), DROPPED_CALLS_30D: u?.dropped ?? 0,
        };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_NETWORK_PERFORMANCE', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Network Performance',
      columns: [
        col('KPI_DATE', 'DATE', 'Date'), col('SITE_ID', 'VARCHAR(10)', 'Cell site', { termId: 'T-016', tags: ['CDE'] }), col('MARKET', 'VARCHAR(30)', 'Market'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }),
        col('TECHNOLOGY', 'VARCHAR(4)', '5G / LTE'), col('CALL_ATTEMPTS', 'NUMBER(10)', 'Call attempts'), col('DROPPED_CALLS', 'NUMBER(8)', 'Dropped calls', { termId: 'T-013', tags: ['CDE'] }),
        col('SETUP_FAILURES', 'NUMBER(8)', 'Call setup failures', { termId: 'T-015' }), col('DOWNTIME_MIN', 'NUMBER(6)', 'Downtime minutes', { termId: 'T-014', tags: ['CDE'] }),
        col('DATA_TB', 'NUMBER(10,3)', 'Data carried (TB)'), col('AVG_THROUGHPUT_MBPS', 'NUMBER(6,1)', 'Downlink throughput', { termId: 'T-030' }),
      ],
      rowCount: 4_258_800, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:21:00', upstream: ['CONFORMED_GOLD.FCT_NETWORK_DAILY', 'CONFORMED_GOLD.DIM_CELL_SITE'], rowAccess: regionAccess,
      rows: memo(() => d.network.slice().reverse().map((n) => { const s = siteByKey.get(n.siteKey)!; return { KPI_DATE: n.date, SITE_ID: n.siteId, MARKET: s.market, REGION: n.region, TECHNOLOGY: s.technology, CALL_ATTEMPTS: n.attempts, DROPPED_CALLS: n.dropped, SETUP_FAILURES: n.setupFail, DOWNTIME_MIN: n.downtimeMin, DATA_TB: n.dataTb, AVG_THROUGHPUT_MBPS: n.throughput }; })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_USAGE_REVENUE', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Usage & Revenue',
      columns: [
        col('INVOICE_ID', 'VARCHAR(24)', 'Invoice'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber', { termId: 'T-001' }), col('INVOICE_MONTH', 'VARCHAR(7)', 'Billing month'),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('MARKET', 'VARCHAR(30)', 'Market'), col('PLAN_NAME', 'VARCHAR(30)', 'Rate plan', { termId: 'T-012' }), col('SEGMENT', 'VARCHAR(10)', 'Segment'),
        col('RATED_AMOUNT', 'NUMBER(12,2)', 'Rated charges', { termId: 'T-018', tags: ['CDE'] }), col('SERVICE_REVENUE', 'NUMBER(12,2)', 'Billed service revenue', { termId: 'T-010', tags: ['CDE'] }),
        col('LEAKAGE_AMOUNT', 'NUMBER(12,2)', 'Rated but not billed', { termId: 'T-017', tags: ['CDE'] }), col('ROAMING_REVENUE', 'NUMBER(12,2)', 'Roaming revenue', { termId: 'T-028' }),
      ],
      rowCount: 301_448_117, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:06:00', upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE', 'CONFORMED_GOLD.DIM_PLAN'], rowAccess: regionAccess,
      rows: memo(() => d.invoices.slice().reverse().map((v) => ({ INVOICE_ID: v.id, SUBSCRIBER_ID: v.subId, INVOICE_MONTH: v.month, REGION: v.region, MARKET: v.market, PLAN_NAME: v.planName, SEGMENT: v.segment, RATED_AMOUNT: v.rated, SERVICE_REVENUE: v.billed, LEAKAGE_AMOUNT: v.leakage, ROAMING_REVENUE: v.roaming }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CHURN_RETENTION', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Churn & Retention',
      columns: [
        col('MONTH', 'VARCHAR(7)', 'Month'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('MARKET', 'VARCHAR(30)', 'Market'),
        col('PLAN_NAME', 'VARCHAR(30)', 'Rate plan', { termId: 'T-012' }), col('SEGMENT', 'VARCHAR(10)', 'Segment'),
        col('OPENING_BASE', 'NUMBER(10)', 'Opening base', { termId: 'T-004', tags: ['CDE'] }), col('GROSS_ADDS', 'NUMBER(8)', 'Gross adds', { termId: 'T-008' }),
        col('VOLUNTARY_DISCONNECTS', 'NUMBER(8)', 'Voluntary disconnects', { termId: 'T-025', tags: ['CDE'] }), col('PORT_OUTS', 'NUMBER(8)', 'Port-outs', { termId: 'T-005', tags: ['CDE'] }),
        col('INVOLUNTARY_DISCONNECTS', 'NUMBER(8)', 'Involuntary disconnects'), col('MIGRATIONS_OUT', 'NUMBER(8)', 'Plan migrations out (excluded from churn)', { termId: 'T-006', tags: ['CDE'] }),
        col('MIGRATIONS_IN', 'NUMBER(8)', 'Plan migrations in', { termId: 'T-006' }), col('CLOSING_BASE', 'NUMBER(10)', 'Closing base'),
      ],
      rowCount: 52_416, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:42:00', upstream: ['CONFORMED_GOLD.FCT_SUBSCRIBER_MONTHLY', 'CONFORMED_GOLD.DIM_PLAN', 'CONFORMED_GOLD.DIM_MARKET'], rowAccess: regionAccess,
      rows: memo(() => d.base.slice().reverse().map((r) => ({ MONTH: r.month, REGION: r.region, MARKET: r.market, PLAN_NAME: r.planName, SEGMENT: r.segment, OPENING_BASE: r.opening, GROSS_ADDS: r.grossAdds, VOLUNTARY_DISCONNECTS: r.voluntary, PORT_OUTS: r.portOuts, INVOLUNTARY_DISCONNECTS: r.involuntary, MIGRATIONS_OUT: r.migOut, MIGRATIONS_IN: r.migIn, CLOSING_BASE: r.closing }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_DEVICE_PLAN_PROFITABILITY', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Device & Plan Profitability (in certification)',
      columns: [
        col('INVOICE_ID', 'VARCHAR(24)', 'Invoice'), col('SUBSCRIBER_ID', 'VARCHAR(12)', 'Subscriber', { termId: 'T-001' }),
        col('MSISDN', 'VARCHAR(16)', 'Mobile number (from DIM_SUBSCRIBER)', { tags: ['CPNI'], termId: 'T-019', maskPendingFix: GATE6_CHECK }),
        col('INVOICE_MONTH', 'VARCHAR(7)', 'Billing month'), col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('PLAN_NAME', 'VARCHAR(30)', 'Rate plan', { termId: 'T-012' }),
        col('DEVICE_MODEL', 'VARCHAR(30)', 'Handset'), col('SERVICE_REVENUE', 'NUMBER(12,2)', 'Billed service revenue', { termId: 'T-010', tags: ['CDE'] }),
        col('DEVICE_REVENUE', 'NUMBER(12,2)', 'Device installment revenue'), col('COST_OF_SERVICE', 'NUMBER(12,2)', 'Cost of service', { termId: 'T-022', tags: ['CDE'] }),
        col('DEVICE_SUBSIDY', 'NUMBER(12,2)', 'Amortised device subsidy', { termId: 'T-023' }), col('GROSS_MARGIN', 'NUMBER(12,2)', 'Service revenue − cost of service − device subsidy', { termId: 'T-022', tags: ['CDE'] }),
      ],
      rowCount: 301_448_117, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:08:00', upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.DIM_SUBSCRIBER', 'CONFORMED_GOLD.DIM_PLAN'], rowAccess: regionAccess,
      rows: memo(() => d.invoices.slice().reverse().map((v) => ({ INVOICE_ID: v.id, SUBSCRIBER_ID: v.subId, MSISDN: v.msisdn, INVOICE_MONTH: v.month, REGION: v.region, PLAN_NAME: v.planName, DEVICE_MODEL: v.deviceModel, SERVICE_REVENUE: v.billed, DEVICE_REVENUE: v.deviceRevenue, COST_OF_SERVICE: v.costOfService, DEVICE_SUBSIDY: v.deviceSubsidy, GROSS_MARGIN: round(v.billed - v.costOfService - v.deviceSubsidy, 2) }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_FIELD_SERVICE_EFFICIENCY', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Field Service Efficiency (draft)',
      columns: [
        col('WORK_ORDER_ID', 'VARCHAR(12)', 'Work order'), col('WORK_ORDER_TYPE', 'VARCHAR(24)', 'Work order type', { termId: 'T-031' }), col('OPENED_DATE', 'DATE', 'Opened'),
        col('REGION', 'VARCHAR(12)', 'Region', { termId: 'T-003' }), col('MARKET', 'VARCHAR(30)', 'Market'), col('SITE_ID', 'VARCHAR(10)', 'Cell site (network repairs)', { termId: 'T-016' }),
        col('HOURS_TO_RESOLVE', 'NUMBER(6,1)', 'Hours to resolve', { termId: 'T-031' }), col('FIRST_TIME_FIX', 'BOOLEAN', 'Fixed on the first visit', { termId: 'T-021', tags: ['CDE'] }),
        col('REPEAT_VISIT', 'BOOLEAN', 'Needed a second visit'), col('TECHNICIAN_ID', 'VARCHAR(8)', 'Technician'),
      ],
      rowCount: 4_811_402, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CURATED_SILVER.WORK_ORDER', 'CONFORMED_GOLD.FCT_WORK_ORDER'], rowAccess: regionAccess,
      rows: memo(() => d.workOrders.slice().reverse().map((w) => ({ WORK_ORDER_ID: w.id, WORK_ORDER_TYPE: w.type, OPENED_DATE: w.opened, REGION: w.region, MARKET: w.market, SITE_ID: w.siteId, HOURS_TO_RESOLVE: w.hours, FIRST_TIME_FIX: w.ftf, REPEAT_VISIT: w.repeat, TECHNICIAN_ID: w.tech }))),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
