// Bronze / Silver / Gold objects and product output ports for CVH_AI_PLATFORM (spec section 5).
import type { SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import type { HcData } from './data';
import { AS_OF, CARC, FACILITY_TO_MARKET, MARKET_CODE_MAP, SERVICE_LINES } from './generators.config';
import { daysBetween, flagsOf, lastEncounter, openBalanceByPatient, PERIODS } from './queries';

export { GATE6_CHECK };

const cdc = cdcColumns();
const marketAccess = { column: 'MARKET' };
const codeAccess = (c: string) => ({ column: c, map: MARKET_CODE_MAP });
const facilityAccess = (c: string) => ({ column: c, map: FACILITY_TO_MARKET });
const SL_CODE: Record<string, string> = Object.fromEntries(SERVICE_LINES.map((s) => [s.name, s.code]));
const DISP_CODE: Record<string, string> = { Home: '01', 'Home health': '06', 'Skilled nursing': '03', 'Transfer to acute': '02', 'Left AMA': '07', Expired: '20' };

export function buildCatalog(d: HcData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const patSample = d.patients.slice(0, 400);
  const patByKey = new Map(d.patients.map((p) => [p.key, p]));
  const hospByCode = new Map(d.hospitals.map((h) => [h.code, h]));
  const payerOf = (k: number) => d.payers[k - 1];
  const visibleMarket = (m: string) => m === 'North' || m === 'Central';
  const tsOf = (date: string, min: number) => ts(date, min);

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'EHR_PATIENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Patient registration CDC from the EHR (HL7 ADT A04/A08 events), landed as Apache Iceberg on S3',
      columns: [
        col('MRN', 'VARCHAR(12)', 'Medical record number (raw, may carry trailing spaces)', { nullable: false, tags: ['PHI'] }),
        col('PAT_FIRST_NM', 'VARCHAR(40)', 'Patient first name (raw)', { tags: ['PHI'] }), col('PAT_LAST_NM', 'VARCHAR(40)', 'Patient last name (raw)', { tags: ['PHI'] }),
        col('BIRTH_DT', 'DATE', 'Date of birth', { tags: ['PHI'] }), col('EMAIL_ADDR', 'VARCHAR(120)', 'Patient email (raw)', { tags: ['PHI'] }),
        col('ZIP_CD', 'VARCHAR(5)', 'Home ZIP code', { tags: ['PHI'] }), col('MARKET_CD', 'VARCHAR(3)', 'Hospital market code (NTH, CEN, CST, VAL)'),
        col('PRIMARY_PAYER_ID', 'VARCHAR(8)', 'Primary coverage payer id'), col('PAT_STATUS_CD', 'VARCHAR(1)', 'A active, D deceased'), ...cdc,
      ],
      rowCount: 9_412_877, bytes: 1.9e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:52:18', upstream: ['ext:EHR (ADT, encounters)'],
      rowAccess: codeAccess('MARKET_CD'),
      rows: memo(() => withCdc(rng, patSample, (p) => ({
        MRN: rng.chance(0.3) ? `${p.mrn}  ` : p.mrn, PAT_FIRST_NM: noisy(rng, p.first), PAT_LAST_NM: noisy(rng, p.last), BIRTH_DT: p.dob,
        EMAIL_ADDR: rng.chance(0.3) ? p.email.toUpperCase() : p.email, ZIP_CD: p.zip, MARKET_CD: p.marketCode, PRIMARY_PAYER_ID: payerOf(p.payerKey).id,
        PAT_STATUS_CD: p.deathDate ? 'D' : 'A',
      }), '2026-09-01', (p) => visibleMarket(p.market))),
    },
    {
      schema: 'RAW_BRONZE', name: 'EHR_PATIENT_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.PATIENT', columns: [], rowCount: 2_318, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 05:53:00', upstream: ['RAW_BRONZE.EHR_PATIENT_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'EHR_ENCOUNTER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Inpatient and emergency encounters from EHR ADT (A01 admit, A03 discharge, A02 transfer)',
      columns: [
        col('ENC_ID', 'VARCHAR(16)', 'Encounter id'), col('MRN', 'VARCHAR(12)', 'Medical record number', { tags: ['PHI'] }), col('FACILITY_CD', 'VARCHAR(3)', 'Hospital code'),
        col('ENC_TYPE_CD', 'VARCHAR(2)', 'IP inpatient, ED emergency'), col('ADMIT_TS', 'TIMESTAMP_NTZ', 'Admission or ED arrival'), col('DISCH_TS', 'TIMESTAMP_NTZ', 'Discharge (null while in house)'),
        col('SVC_LINE_CD', 'VARCHAR(4)', 'Service line code'), col('DISCH_DISP_CD', 'VARCHAR(2)', 'UB-04 discharge status code'), col('PROVIDER_SEEN_TS', 'TIMESTAMP_NTZ', 'ED first provider contact'), ...cdc,
      ],
      rowCount: 31_604_552, bytes: 4.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:10:41', upstream: ['ext:EHR (ADT, encounters)'],
      rowAccess: facilityAccess('FACILITY_CD'),
      rows: memo(() => {
        const items = [...d.stays.slice(-150).map((s) => ({ k: 'IP' as const, s })), ...d.ed.slice(-150).map((v) => ({ k: 'ED' as const, v }))].reverse();
        return withCdc(rng, items, (x) => {
          if (x.k === 'IP') {
            const s = x.s;
            return { ENC_ID: s.id, MRN: patByKey.get(s.patientKey)!.mrn, FACILITY_CD: s.hospitalCode, ENC_TYPE_CD: 'IP', ADMIT_TS: tsOf(s.admit, 600), DISCH_TS: s.inHouse ? null : tsOf(s.discharge, 660), SVC_LINE_CD: SL_CODE[s.serviceLine], DISCH_DISP_CD: s.inHouse ? null : DISP_CODE[s.disposition], PROVIDER_SEEN_TS: null };
          }
          const v = x.v;
          return { ENC_ID: v.id, MRN: patByKey.get(v.patientKey)!.mrn, FACILITY_CD: v.hospitalCode, ENC_TYPE_CD: 'ED', ADMIT_TS: tsOf(v.date, v.arrivalMin), DISCH_TS: tsOf(v.date, Math.min(1439, v.arrivalMin + (v.waitMin ?? 60) + 140)), SVC_LINE_CD: 'EMER', DISCH_DISP_CD: v.lwbs ? '07' : '01', PROVIDER_SEEN_TS: v.waitMin === null ? null : tsOf(v.date, Math.min(1439, v.arrivalMin + v.waitMin)) };
        }, '2026-09-26', (x) => visibleMarket(x.k === 'IP' ? x.s.market : x.v.market));
      }),
    },
    {
      schema: 'RAW_BRONZE', name: 'CLM_837_835_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Billed claims (837I/837P) joined to remittance advice (835) from the clearinghouse',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Patient control number'), col('ENC_ID', 'VARCHAR(16)', 'Encounter or appointment id'), col('PAYER_ID', 'VARCHAR(8)', 'Payer id'),
        col('TOT_CHG_AMT', 'NUMBER(12,2)', 'Total charges'), col('SUBMIT_DT', 'DATE', '837 submission date'), col('CLM_STATUS_CD', 'VARCHAR(2)', '835 claim status (1 paid, 4 denied, 22 reversal, blank pending)'),
        col('CARC_CD', 'VARCHAR(4)', 'Claim adjustment reason code on denial'), col('PAID_AMT', 'NUMBER(12,2)', 'Paid amount (835)'), col('PAID_DT', 'DATE', 'Remit date'), ...cdc,
      ],
      rowCount: 112_406_215, bytes: 1.6e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:31:07', upstream: ['ext:Claims & remits (837/835)'],
      rows: memo(() => withCdc(rng, d.claims.slice(-300).reverse(), (c) => {
        const done = c.resolvedDate <= AS_OF;
        return {
          CLAIM_ID: c.id, ENC_ID: c.encId, PAYER_ID: payerOf(c.payerKey).id, TOT_CHG_AMT: c.charges, SUBMIT_DT: c.submitDate,
          CLM_STATUS_CD: c.denied && !done ? '4' : done ? '1' : '', CARC_CD: c.denied ? CARC[c.denialReason!] : null, PAID_AMT: done ? c.paid : null, PAID_DT: done ? c.resolvedDate : null,
        };
      }, '2026-09-24')),
    },
    {
      schema: 'RAW_BRONZE', name: 'SCHED_APPT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Clinic appointments from the scheduling system (SIU S12–S15 messages)',
      columns: [
        col('APPT_ID', 'VARCHAR(12)', 'Appointment id'), col('MRN', 'VARCHAR(12)', 'Medical record number', { tags: ['PHI'] }), col('DEPT_ID', 'VARCHAR(8)', 'Clinic department id'),
        col('APPT_DT', 'DATE', 'Appointment date'), col('BOOKED_DT', 'DATE', 'Date booked'), col('VISIT_TYPE_CD', 'VARCHAR(3)', 'NEW or EST'), col('APPT_STATUS_CD', 'VARCHAR(10)', 'Status (raw, mixed case)'), ...cdc,
      ],
      rowCount: 48_920_441, bytes: 3.9e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:02:55', upstream: ['ext:Scheduling'],
      rows: memo(() => withCdc(rng, d.appts.slice(-300).reverse(), (a) => ({
        APPT_ID: a.id, MRN: patByKey.get(a.patientKey)!.mrn, DEPT_ID: d.clinics[a.clinicKey - 1].id, APPT_DT: a.date, BOOKED_DT: a.booked,
        VISIT_TYPE_CD: a.type === 'New' ? 'NEW' : 'EST', APPT_STATUS_CD: noisy(rng, a.status === 'No-show' ? 'NOSHOW' : a.status.toUpperCase()),
      }), '2026-09-22')),
    },
    {
      schema: 'RAW_BRONZE', name: 'RX_DISPENSE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Inpatient pharmacy dispenses from the pharmacy system',
      columns: [
        col('DISPENSE_ID', 'VARCHAR(12)', 'Dispense id'), col('ENC_ID', 'VARCHAR(16)', 'Encounter id'), col('NDC_CD', 'VARCHAR(12)', 'National Drug Code'),
        col('DRUG_NM', 'VARCHAR(60)', 'Drug name (raw)'), col('DISP_QTY', 'NUMBER(6)', 'Units dispensed'), col('UNIT_COST', 'NUMBER(10,2)', 'Acquisition cost per unit'), col('FORMULARY_FLG', 'VARCHAR(1)', 'On formulary (Y/N)'), ...cdc,
      ],
      rowCount: 64_118_090, bytes: 5.2e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:47:30', upstream: ['ext:Pharmacy'],
      rows: memo(() => withCdc(rng, d.supply.filter((l) => l.itemType === 'Pharmacy').slice(-300).reverse(), (l) => ({
        DISPENSE_ID: l.id, ENC_ID: l.encId, NDC_CD: l.itemId, DRUG_NM: noisy(rng, l.desc), DISP_QTY: l.qty, UNIT_COST: l.unitCost, FORMULARY_FLG: l.category === 'Formulary drugs' ? 'Y' : 'N',
      }), '2026-09-20')),
    },
    {
      schema: 'RAW_BRONZE', name: 'SUPPLY_USAGE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 7,
      comment: 'Point-of-use supply and implant capture from the supply chain system',
      columns: [
        col('USAGE_ID', 'VARCHAR(12)', 'Usage line id'), col('CASE_ID', 'VARCHAR(16)', 'Encounter / surgical case id'), col('PATIENT_MRN', 'VARCHAR(12)', 'Medical record number', { tags: ['PHI'] }),
        col('ITEM_ID', 'VARCHAR(10)', 'Item master id'), col('ITEM_DESC', 'VARCHAR(60)', 'Item description (raw)'), col('USE_QTY', 'NUMBER(6)', 'Quantity used'),
        col('UNIT_COST', 'NUMBER(10,2)', 'Unit cost'), col('VENDOR_NM', 'VARCHAR(40)', 'Vendor (raw)'), col('CONTRACT_NO', 'VARCHAR(12)', 'GPO or local contract number'), ...cdc,
      ],
      rowCount: 22_870_334, bytes: 2.7e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:58:12', upstream: ['ext:Supply chain'],
      rows: memo(() => withCdc(rng, d.supply.filter((l) => l.itemType === 'Supply').slice(-300).reverse(), (l) => ({
        USAGE_ID: l.id, CASE_ID: l.encId, PATIENT_MRN: l.mrn, ITEM_ID: l.itemId, ITEM_DESC: noisy(rng, l.desc), USE_QTY: l.qty, UNIT_COST: l.unitCost,
        VENDOR_NM: noisy(rng, l.vendor), CONTRACT_NO: l.onContract ? `GPO-${pad(3100 + l.desc.length * 7, 6)}` : null,
      }), '2026-09-18')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'PATIENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 patient entity (enterprise master patient index applied)',
      columns: [
        col('MRN', 'VARCHAR(10)', 'Medical record number (trimmed)', { nullable: false, termId: 'T-001', tags: ['CDE', 'PHI'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PHI'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PHI'] }),
        col('BIRTH_DATE', 'DATE', 'Date of birth', { tags: ['PHI'] }), col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PHI'] }),
        col('MARKET_CODE', 'VARCHAR(3)', 'Hospital market code', { termId: 'T-003' }), col('PRIMARY_PAYER_ID', 'VARCHAR(8)', 'Primary coverage', { termId: 'T-020' }),
        col('PATIENT_STATUS', 'VARCHAR(10)', 'Active / Deceased', { termId: 'T-002' }), col('PORTAL_ENROLLED', 'BOOLEAN', 'Patient portal account active', { termId: 'T-027' }),
        col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 1_318_906, bytes: 2.4e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:08:40', upstream: ['RAW_BRONZE.EHR_PATIENT_CDC_STRM'],
      rowAccess: codeAccess('MARKET_CODE'),
      rows: memo(() => patSample.flatMap((p) => {
        const cur = { MRN: p.mrn, FIRST_NAME: p.first, LAST_NAME: p.last, BIRTH_DATE: p.dob, EMAIL: p.email, MARKET_CODE: p.marketCode, PRIMARY_PAYER_ID: payerOf(p.payerKey).id, PATIENT_STATUS: p.deathDate ? 'Deceased' : 'Active', PORTAL_ENROLLED: p.portal };
        return p.priorPayerKey
          ? [{ ...cur, PRIMARY_PAYER_ID: payerOf(p.priorPayerKey).id, EFFECTIVE_FROM: '2021-01-01', EFFECTIVE_TO: addDays(p.changedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: p.changedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: p.effectiveFrom, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'ENCOUNTER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 2,
      comment: 'Cleansed inpatient and ED encounters with LOS, disposition, planned flag and ED timestamps',
      columns: [
        col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter id', { termId: 'T-004' }), col('MRN', 'VARCHAR(10)', 'Medical record number', { tags: ['PHI'] }),
        col('FACILITY_CODE', 'VARCHAR(3)', 'Hospital code'), col('ENCOUNTER_TYPE', 'VARCHAR(10)', 'Inpatient / Emergency'),
        col('ADMIT_DATE', 'DATE', 'Admission or arrival date'), col('DISCHARGE_DATE', 'DATE', 'Discharge date'), col('LOS_DAYS', 'NUMBER(4)', 'Length of stay (midnights)', { termId: 'T-005' }),
        col('SERVICE_LINE', 'VARCHAR(30)', 'Service line', { termId: 'T-009' }), col('DISCHARGE_DISPOSITION', 'VARCHAR(20)', 'Discharge disposition'),
        col('IS_PLANNED', 'BOOLEAN', 'Planned admission (CMS planned readmission algorithm)', { termId: 'T-008' }), col('ED_WAIT_MIN', 'NUMBER(5)', 'Door-to-provider minutes', { termId: 'T-011' }), col('LWBS_FLAG', 'BOOLEAN', 'Left without being seen', { termId: 'T-012' }),
      ],
      rowCount: 31_288_190, bytes: 3.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:12:55', upstream: ['RAW_BRONZE.EHR_ENCOUNTER_CDC'],
      rowAccess: facilityAccess('FACILITY_CODE'),
      rows: memo(() => [
        ...d.stays.slice().reverse().map((s) => ({ ENCOUNTER_ID: s.id, MRN: patByKey.get(s.patientKey)!.mrn, FACILITY_CODE: s.hospitalCode, ENCOUNTER_TYPE: 'Inpatient', ADMIT_DATE: s.admit, DISCHARGE_DATE: s.inHouse ? null : s.discharge, LOS_DAYS: s.inHouse ? null : s.los, SERVICE_LINE: s.serviceLine, DISCHARGE_DISPOSITION: s.disposition, IS_PLANNED: s.planned, ED_WAIT_MIN: null, LWBS_FLAG: false })),
        ...d.ed.slice(-1500).reverse().map((v) => ({ ENCOUNTER_ID: v.id, MRN: patByKey.get(v.patientKey)!.mrn, FACILITY_CODE: v.hospitalCode, ENCOUNTER_TYPE: 'Emergency', ADMIT_DATE: v.date, DISCHARGE_DATE: v.date, LOS_DAYS: 0, SERVICE_LINE: 'Emergency', DISCHARGE_DISPOSITION: v.lwbs ? 'Left without being seen' : v.admitted ? 'Admitted' : 'Home', IS_PLANNED: false, ED_WAIT_MIN: v.waitMin, LWBS_FLAG: v.lwbs })),
      ]),
    },
    {
      schema: 'CURATED_SILVER', name: 'CLAIM', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 3,
      comment: 'Claims with first-pass edit result, initial denial and remittance',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Claim id', { termId: 'T-015' }), col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter or appointment id'), col('PAYER_ID', 'VARCHAR(8)', 'Payer'),
        col('SERVICE_DATE', 'DATE', 'Service or discharge date'), col('SUBMIT_DATE', 'DATE', 'Submitted'), col('IS_CLEAN', 'BOOLEAN', 'Passed all edits on first submission', { termId: 'T-016' }),
        col('IS_DENIED', 'BOOLEAN', 'Initially denied by payer', { termId: 'T-017' }), col('DENIAL_REASON', 'VARCHAR(30)', 'Denial category (from CARC)'),
        col('EXPECTED_NET_USD', 'NUMBER(12,2)', 'Expected net reimbursement'), col('PAID_USD', 'NUMBER(12,2)', 'Paid to date'), col('RESOLVED_DATE', 'DATE', 'Paid or written off'),
      ],
      rowCount: 104_880_412, bytes: 9.4e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:40:13', upstream: ['RAW_BRONZE.CLM_837_835_CDC'],
      rows: memo(() => d.claims.slice(-3000).reverse().map((c) => {
        const done = c.resolvedDate <= AS_OF;
        return { CLAIM_ID: c.id, ENCOUNTER_ID: c.encId, PAYER_ID: payerOf(c.payerKey).id, SERVICE_DATE: c.serviceDate, SUBMIT_DATE: c.submitDate, IS_CLEAN: c.clean, IS_DENIED: c.denied, DENIAL_REASON: c.denialReason, EXPECTED_NET_USD: c.expected, PAID_USD: done ? c.paid : 0, RESOLVED_DATE: done ? c.resolvedDate : null };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'APPOINTMENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 4,
      comment: 'Typed clinic appointments with lead time and status',
      columns: [
        col('APPOINTMENT_ID', 'VARCHAR(12)', 'Appointment id'), col('MRN', 'VARCHAR(10)', 'Medical record number', { tags: ['PHI'] }), col('CLINIC_ID', 'VARCHAR(8)', 'Clinic'),
        col('APPT_DATE', 'DATE', 'Appointment date'), col('BOOKED_DATE', 'DATE', 'Booked'), col('LEAD_DAYS', 'NUMBER(4)', 'Days from booking to appointment', { termId: 'T-014' }),
        col('VISIT_TYPE', 'VARCHAR(12)', 'New / Established'), col('APPT_STATUS', 'VARCHAR(10)', 'Completed / No-show / Cancelled', { termId: 'T-013' }),
      ],
      rowCount: 47_612_003, bytes: 2.8e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:04:31', upstream: ['RAW_BRONZE.SCHED_APPT_CDC'],
      rows: memo(() => d.appts.slice(-3000).reverse().map((a) => ({ APPOINTMENT_ID: a.id, MRN: patByKey.get(a.patientKey)!.mrn, CLINIC_ID: d.clinics[a.clinicKey - 1].id, APPT_DATE: a.date, BOOKED_DATE: a.booked, LEAD_DAYS: a.lag, VISIT_TYPE: a.type, APPT_STATUS: a.status }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'PHARMACY_DISPENSE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Typed pharmacy dispenses with extended cost',
      columns: [
        col('DISPENSE_ID', 'VARCHAR(12)', 'Dispense id'), col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter'), col('NDC', 'VARCHAR(12)', 'NDC'), col('DRUG_NAME', 'VARCHAR(60)', 'Drug'),
        col('QTY', 'NUMBER(6)', 'Units'), col('COST_USD', 'NUMBER(12,2)', 'Extended cost', { termId: 'T-029' }), col('ON_FORMULARY', 'BOOLEAN', 'On formulary'),
      ],
      rowCount: 63_904_118, bytes: 3.3e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:49:02', upstream: ['RAW_BRONZE.RX_DISPENSE_CDC'],
      rows: memo(() => d.supply.filter((l) => l.itemType === 'Pharmacy').slice(-2000).reverse().map((l) => ({ DISPENSE_ID: l.id, ENCOUNTER_ID: l.encId, NDC: l.itemId, DRUG_NAME: l.desc, QTY: l.qty, COST_USD: l.cost, ON_FORMULARY: l.category === 'Formulary drugs' }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SUPPLY_USAGE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6,
      comment: 'Supply and implant usage per encounter with category, vendor and contract flag',
      columns: [
        col('USAGE_ID', 'VARCHAR(12)', 'Usage line'), col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter / case'), col('PATIENT_MRN', 'VARCHAR(10)', 'Medical record number', { tags: ['PHI'] }),
        col('ITEM_ID', 'VARCHAR(10)', 'Item'), col('ITEM_DESC', 'VARCHAR(60)', 'Item description'), col('CATEGORY', 'VARCHAR(30)', 'Supply category'), col('VENDOR', 'VARCHAR(40)', 'Vendor'),
        col('QTY', 'NUMBER(6)', 'Quantity'), col('COST_USD', 'NUMBER(12,2)', 'Extended cost', { termId: 'T-029' }), col('ON_CONTRACT', 'BOOLEAN', 'Bought under a GPO or local contract', { termId: 'T-025' }),
      ],
      rowCount: 22_104_871, bytes: 1.8e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:02:44', upstream: ['RAW_BRONZE.SUPPLY_USAGE_CDC'],
      rows: memo(() => d.supply.filter((l) => l.itemType === 'Supply').slice().reverse().map((l) => ({ USAGE_ID: l.id, ENCOUNTER_ID: l.encId, PATIENT_MRN: l.mrn, ITEM_ID: l.itemId, ITEM_DESC: l.desc, CATEGORY: l.category, VENDOR: l.vendor, QTY: l.qty, COST_USD: l.cost, ON_CONTRACT: l.onContract }))),
    },
  ];

  const allDates: string[] = [];
  for (let x = '2025-01-01'; x <= AS_OF; x = addDays(x, 1)) allDates.push(x);
  const flags = memo(() => flagsOf(d));
  const hospKey = (code: string) => hospByCode.get(code)!.key;
  const followed = memo(() => {
    // Mirrors followup7(): discharges home / home health with a completed visit 1–7 days later.
    const visits = new Map<number, string[]>();
    for (const a of d.appts) if (a.status === 'Completed') { const xs = visits.get(a.patientKey) ?? []; xs.push(a.date); visits.set(a.patientKey, xs); }
    return (patientKey: number, discharge: string) => (visits.get(patientKey) ?? []).some((v) => { const g = daysBetween(discharge, v); return g >= 1 && g <= 7; });
  });

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PATIENT', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed patient dimension (current version)',
      columns: [
        col('PATIENT_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('MRN', 'VARCHAR(10)', 'Medical record number', { termId: 'T-001', tags: ['CDE', 'PHI'] }),
        col('PATIENT_NAME', 'VARCHAR(80)', 'Patient name', { tags: ['PHI'] }), col('BIRTH_DATE', 'DATE', 'Date of birth', { tags: ['PHI'] }),
        col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }), col('HOME_HOSPITAL', 'VARCHAR(50)', 'Home hospital'),
        col('PAYER_CLASS', 'VARCHAR(12)', 'Medicare / Medicaid / Commercial / Self-pay', { termId: 'T-020', tags: ['CDE'] }), col('PORTAL_ENROLLED', 'BOOLEAN', 'Patient portal enrolled', { termId: 'T-027' }),
        col('RISK_SCORE', 'NUMBER(5,2)', 'Patient risk score (HCC-style)', { termId: 'T-021' }), col('PATIENT_STATUS', 'VARCHAR(10)', 'Active / Deceased', { termId: 'T-002' }),
      ],
      rowCount: 1_240_000, bytes: 1.6e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:15:00', upstream: ['CURATED_SILVER.PATIENT'], rowAccess: marketAccess,
      rows: memo(() => d.patients.map((p) => ({ PATIENT_KEY: p.key, MRN: p.mrn, PATIENT_NAME: `${p.first} ${p.last}`, BIRTH_DATE: p.dob, MARKET: p.market, HOME_HOSPITAL: hospByCode.get(p.homeHospital)!.name, PAYER_CLASS: payerOf(p.payerKey).payerClass, PORTAL_ENROLLED: p.portal, RISK_SCORE: p.risk, PATIENT_STATUS: p.deathDate ? 'Deceased' : 'Active' }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_FACILITY', layer: 'gold', type: 'TABLE', order: 2, comment: 'Hospitals with market, staffed beds and trauma level',
      columns: [
        col('FACILITY_KEY', 'NUMBER', 'Surrogate key'), col('FACILITY_CODE', 'VARCHAR(3)', 'Hospital code'), col('FACILITY_NAME', 'VARCHAR(50)', 'Hospital'),
        col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }), col('CITY', 'VARCHAR(30)', 'City'),
        col('STAFFED_BEDS', 'NUMBER(5)', 'Staffed inpatient beds (occupancy denominator)', { termId: 'T-010' }), col('TRAUMA_LEVEL', 'VARCHAR(4)', 'Trauma designation'),
      ],
      rowCount: 14, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.ENCOUNTER'], rowAccess: marketAccess,
      rows: memo(() => d.hospitals.map((h) => ({ FACILITY_KEY: h.key, FACILITY_CODE: h.code, FACILITY_NAME: h.name, MARKET: h.market, CITY: h.city, STAFFED_BEDS: h.beds, TRAUMA_LEVEL: h.trauma }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CLINIC', layer: 'gold', type: 'TABLE', order: 3, comment: 'Ambulatory clinics (210) with specialty and market',
      columns: [col('CLINIC_KEY', 'NUMBER', 'Surrogate key'), col('CLINIC_ID', 'VARCHAR(8)', 'Clinic id'), col('CLINIC_NAME', 'VARCHAR(60)', 'Clinic'), col('SPECIALTY', 'VARCHAR(30)', 'Specialty'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('PARENT_FACILITY', 'VARCHAR(3)', 'Affiliated hospital')],
      rowCount: 210, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-15 02:00:00', upstream: ['CURATED_SILVER.APPOINTMENT'], rowAccess: marketAccess,
      rows: memo(() => d.clinics.map((c) => ({ CLINIC_KEY: c.key, CLINIC_ID: c.id, CLINIC_NAME: c.name, SPECIALTY: c.specialty, MARKET: c.market, PARENT_FACILITY: c.hospitalCode }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PAYER', layer: 'gold', type: 'TABLE', order: 4, comment: 'Payers and payer class',
      columns: [col('PAYER_KEY', 'NUMBER', 'Surrogate key'), col('PAYER_ID', 'VARCHAR(8)', 'Payer id'), col('PAYER_NAME', 'VARCHAR(40)', 'Payer'), col('PAYER_CLASS', 'VARCHAR(12)', 'Payer class', { termId: 'T-020', tags: ['CDE'] })],
      rowCount: 8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-07-01 02:00:00', upstream: ['CURATED_SILVER.CLAIM'],
      rows: memo(() => d.payers.map((p) => ({ PAYER_KEY: p.key, PAYER_ID: p.id, PAYER_NAME: p.name, PAYER_CLASS: p.payerClass }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 5, comment: 'Calendar with fiscal periods (FY = calendar year)',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_WEEKDAY', 'BOOLEAN', 'Monday–Friday')],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => { const w = new Date(`${x}T00:00:00Z`).getUTCDay(); return { DATE_KEY: dateKey(x), CALENDAR_DATE: x, FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_WEEKDAY: w !== 0 && w !== 6 }; })),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_ENCOUNTER', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 6, comment: 'Inpatient stays and ED visits at encounter grain',
      columns: [
        col('ENCOUNTER_KEY', 'NUMBER', 'Encounter'), col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter id', { termId: 'T-004', tags: ['CDE'] }), col('PATIENT_KEY', 'NUMBER', 'Patient'), col('FACILITY_KEY', 'NUMBER', 'Hospital'),
        col('DATE_KEY', 'NUMBER(8)', 'Admission / arrival date'), col('ENCOUNTER_TYPE', 'VARCHAR(10)', 'Inpatient / Emergency'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }),
        col('SERVICE_LINE', 'VARCHAR(30)', 'Service line', { termId: 'T-009', tags: ['CDE'] }), col('DISCHARGE_DATE', 'DATE', 'Discharge date', { termId: 'T-030' }),
        col('LOS_DAYS', 'NUMBER(4)', 'Length of stay', { termId: 'T-005', tags: ['CDE'] }), col('DISCHARGE_DISPOSITION', 'VARCHAR(24)', 'Disposition'),
        col('ED_WAIT_MIN', 'NUMBER(5)', 'Door-to-provider minutes', { termId: 'T-011', tags: ['CDE'] }), col('LWBS_FLAG', 'BOOLEAN', 'Left without being seen', { termId: 'T-012' }),
      ],
      rowCount: 30_906_118, bytes: 2.2e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:13:30', upstream: ['CURATED_SILVER.ENCOUNTER', 'CONFORMED_GOLD.DIM_FACILITY', 'CONFORMED_GOLD.DIM_PATIENT'], rowAccess: marketAccess,
      rows: memo(() => [
        ...d.stays.slice().reverse().map((s) => ({ ENCOUNTER_KEY: s.key, ENCOUNTER_ID: s.id, PATIENT_KEY: s.patientKey, FACILITY_KEY: hospKey(s.hospitalCode), DATE_KEY: dateKey(s.admit), ENCOUNTER_TYPE: 'Inpatient', MARKET: s.market, SERVICE_LINE: s.serviceLine, DISCHARGE_DATE: s.inHouse ? null : s.discharge, LOS_DAYS: s.inHouse ? null : s.los, DISCHARGE_DISPOSITION: s.disposition, ED_WAIT_MIN: null, LWBS_FLAG: false })),
        ...d.ed.slice().reverse().map((v) => ({ ENCOUNTER_KEY: 500_000 + v.key, ENCOUNTER_ID: v.id, PATIENT_KEY: v.patientKey, FACILITY_KEY: hospKey(v.hospitalCode), DATE_KEY: dateKey(v.date), ENCOUNTER_TYPE: 'Emergency', MARKET: v.market, SERVICE_LINE: 'Emergency', DISCHARGE_DATE: v.date, LOS_DAYS: 0, DISCHARGE_DISPOSITION: v.lwbs ? 'Left without being seen' : v.admitted ? 'Admitted' : 'Home', ED_WAIT_MIN: v.waitMin, LWBS_FLAG: v.lwbs })),
      ]),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_READMISSION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 7, comment: 'Index inpatient discharges with 30-day readmission outcome (CMS method)',
      columns: [
        col('INDEX_STAY_KEY', 'NUMBER', 'Index stay'), col('PATIENT_KEY', 'NUMBER', 'Patient'), col('FACILITY_KEY', 'NUMBER', 'Hospital'), col('DATE_KEY', 'NUMBER(8)', 'Index discharge date'),
        col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('SERVICE_LINE', 'VARCHAR(30)', 'Service line of the index stay', { termId: 'T-009', tags: ['CDE'] }),
        col('DISCHARGE_DISPOSITION', 'VARCHAR(24)', 'Disposition of the index stay'),
        col('IS_ELIGIBLE_INDEX', 'BOOLEAN', 'Eligible index stay (excludes transfers, deaths, AMA)', { termId: 'T-007', tags: ['CDE'] }),
        col('READMIT_30D_FLAG', 'BOOLEAN', 'Unplanned readmission within 30 days', { termId: 'T-006', tags: ['CDE'] }),
        col('PLANNED_READMIT_EXCLUDED', 'BOOLEAN', 'Only a planned readmission followed (not counted)', { termId: 'T-008', tags: ['CDE'] }),
        col('DAYS_TO_READMIT', 'NUMBER(3)', 'Days from discharge to readmission'), col('READMIT_STAY_KEY', 'NUMBER', 'Readmission stay'),
        col('FOLLOWUP_7D_FLAG', 'BOOLEAN', 'Completed clinic visit 1–7 days after discharge', { termId: 'T-022' }), col('EXPIRED_FLAG', 'BOOLEAN', 'Died in hospital', { termId: 'T-023' }),
      ],
      rowCount: 1_104_662, bytes: 1.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:00', upstream: ['CONFORMED_GOLD.FCT_ENCOUNTER', 'CONFORMED_GOLD.FCT_APPOINTMENT'], rowAccess: marketAccess,
      rows: memo(() => d.stays.filter((s) => !s.inHouse).reverse().map((s) => {
        const f = flags().get(s.key)!;
        return {
          INDEX_STAY_KEY: s.key, PATIENT_KEY: s.patientKey, FACILITY_KEY: hospKey(s.hospitalCode), DATE_KEY: dateKey(s.discharge), MARKET: s.market, SERVICE_LINE: s.serviceLine, DISCHARGE_DISPOSITION: s.disposition,
          IS_ELIGIBLE_INDEX: f.eligible, READMIT_30D_FLAG: f.readmit, PLANNED_READMIT_EXCLUDED: f.plannedExcluded, DAYS_TO_READMIT: f.days ?? null, READMIT_STAY_KEY: f.readmitKey ?? null,
          FOLLOWUP_7D_FLAG: ['Home', 'Home health'].includes(s.disposition) ? followed()(s.patientKey, s.discharge) : null, EXPIRED_FLAG: s.disposition === 'Expired',
        };
      })),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_CLAIM', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 8, comment: 'Claims and remits at claim grain with A/R status at the as-of date',
      columns: [
        col('CLAIM_KEY', 'NUMBER', 'Claim'), col('CLAIM_ID', 'VARCHAR(16)', 'Claim id', { termId: 'T-015', tags: ['CDE'] }), col('PATIENT_KEY', 'NUMBER', 'Patient'), col('PAYER_KEY', 'NUMBER', 'Payer'),
        col('DATE_KEY', 'NUMBER(8)', 'Submission date'), col('SERVICE_DATE', 'DATE', 'Service / discharge date'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('ENCOUNTER_TYPE', 'VARCHAR(10)', 'IP / ED / OP'),
        col('EXPECTED_NET_USD', 'NUMBER(12,2)', 'Expected net reimbursement', { termId: 'T-019' }), col('IS_CLEAN', 'BOOLEAN', 'Clean on first submission', { termId: 'T-016', tags: ['CDE'] }),
        col('IS_DENIED', 'BOOLEAN', 'Initially denied', { termId: 'T-017', tags: ['CDE'] }), col('DENIAL_REASON', 'VARCHAR(30)', 'Denial category'), col('PAID_USD', 'NUMBER(12,2)', 'Paid to date'),
        col('OPEN_AR_USD', 'NUMBER(12,2)', 'Open A/R at the as-of date', { termId: 'T-018', tags: ['CDE'] }), col('DAYS_OUTSTANDING', 'NUMBER(4)', 'Days since service while open', { termId: 'T-028' }),
      ],
      rowCount: 104_880_412, bytes: 7.7e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:44:51', upstream: ['CURATED_SILVER.CLAIM', 'CONFORMED_GOLD.DIM_PAYER', 'CONFORMED_GOLD.DIM_PATIENT'], rowAccess: marketAccess,
      rows: memo(() => d.claims.slice().reverse().map((c) => {
        const open = c.resolvedDate > AS_OF;
        return { CLAIM_KEY: c.key, CLAIM_ID: c.id, PATIENT_KEY: c.patientKey, PAYER_KEY: c.payerKey, DATE_KEY: dateKey(c.submitDate), SERVICE_DATE: c.serviceDate, MARKET: c.market, ENCOUNTER_TYPE: c.encType, EXPECTED_NET_USD: c.expected, IS_CLEAN: c.clean, IS_DENIED: c.denied, DENIAL_REASON: c.denialReason, PAID_USD: open ? 0 : c.paid, OPEN_AR_USD: open ? c.expected : 0, DAYS_OUTSTANDING: open ? daysBetween(c.serviceDate, AS_OF) : null };
      })),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_APPOINTMENT', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 9, comment: 'Clinic appointments at appointment grain',
      columns: [
        col('APPOINTMENT_KEY', 'NUMBER', 'Appointment'), col('PATIENT_KEY', 'NUMBER', 'Patient'), col('CLINIC_KEY', 'NUMBER', 'Clinic'), col('DATE_KEY', 'NUMBER(8)', 'Appointment date'),
        col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('VISIT_TYPE', 'VARCHAR(12)', 'New / Established'), col('APPT_STATUS', 'VARCHAR(10)', 'Completed / No-show / Cancelled', { termId: 'T-013' }),
        col('LEAD_DAYS', 'NUMBER(4)', 'Booking-to-appointment days', { termId: 'T-014' }), col('IS_POST_DISCHARGE', 'BOOLEAN', 'Scheduled at hospital discharge', { termId: 'T-022' }),
      ],
      rowCount: 46_880_550, bytes: 2.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:05:10', upstream: ['CURATED_SILVER.APPOINTMENT', 'CONFORMED_GOLD.DIM_CLINIC'], rowAccess: marketAccess,
      rows: memo(() => d.appts.slice().reverse().map((a) => ({ APPOINTMENT_KEY: a.key, PATIENT_KEY: a.patientKey, CLINIC_KEY: a.clinicKey, DATE_KEY: dateKey(a.date), MARKET: a.market, VISIT_TYPE: a.type, APPT_STATUS: a.status, LEAD_DAYS: a.lag, IS_POST_DISCHARGE: a.postDischarge }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SUPPLY_USAGE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 10, comment: 'Supply, implant and pharmacy cost at usage-line grain',
      columns: [
        col('USAGE_KEY', 'NUMBER', 'Usage line'), col('ENCOUNTER_KEY', 'NUMBER', 'Inpatient stay / surgical case'), col('DATE_KEY', 'NUMBER(8)', 'Usage date'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }),
        col('PATIENT_MRN', 'VARCHAR(10)', 'Medical record number (carried for case costing)', { tags: ['PHI'], maskPendingFix: GATE6_CHECK }),
        col('ITEM_TYPE', 'VARCHAR(10)', 'Supply / Pharmacy'), col('CATEGORY', 'VARCHAR(30)', 'Category'), col('VENDOR', 'VARCHAR(40)', 'Vendor'),
        col('COST_USD', 'NUMBER(12,2)', 'Extended cost', { termId: 'T-029', tags: ['CDE'] }), col('ON_CONTRACT', 'BOOLEAN', 'On contract', { termId: 'T-025', tags: ['CDE'] }),
        col('IS_SURGICAL_CASE', 'BOOLEAN', 'Stay is a surgical case', { termId: 'T-024', tags: ['CDE'] }),
      ],
      rowCount: 86_420_118, bytes: 4.0e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:12:09', upstream: ['CURATED_SILVER.SUPPLY_USAGE', 'CURATED_SILVER.PHARMACY_DISPENSE', 'CONFORMED_GOLD.FCT_ENCOUNTER'], rowAccess: marketAccess,
      rows: memo(() => d.supply.slice().reverse().map((l) => ({ USAGE_KEY: l.key, ENCOUNTER_KEY: l.stayKey, DATE_KEY: dateKey(l.date), MARKET: l.market, PATIENT_MRN: l.mrn, ITEM_TYPE: l.itemType, CATEGORY: l.category, VENDOR: l.vendor, COST_USD: l.cost, ON_CONTRACT: l.onContract, IS_SURGICAL_CASE: l.surgical }))),
    },
  ];

  const balances = memo(() => openBalanceByPatient(d));
  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PATIENT_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Patient 360',
      columns: [
        col('MRN', 'VARCHAR(10)', 'Medical record number', { termId: 'T-001', tags: ['CDE', 'PHI'] }), col('PATIENT_NAME', 'VARCHAR(80)', 'Patient name', { tags: ['PHI'] }),
        col('BIRTH_DATE', 'DATE', 'Date of birth', { tags: ['PHI'] }), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }), col('HOME_HOSPITAL', 'VARCHAR(50)', 'Home hospital'),
        col('PAYER_CLASS', 'VARCHAR(12)', 'Payer class', { termId: 'T-020', tags: ['CDE'] }), col('PRIMARY_PAYER', 'VARCHAR(40)', 'Primary payer'),
        col('IS_ACTIVE', 'BOOLEAN', 'Active patient (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('PORTAL_ENROLLED', 'BOOLEAN', 'Portal enrolled', { termId: 'T-027' }),
        col('RISK_SCORE', 'NUMBER(5,2)', 'Patient risk score', { termId: 'T-021' }), col('LAST_ENCOUNTER_DATE', 'DATE', 'Latest completed encounter'),
        col('OPEN_AR_BALANCE', 'NUMBER(12,2)', 'Open account balance', { termId: 'T-018' }), col('AGED_90_BALANCE', 'NUMBER(12,2)', 'Open balance older than 90 days', { termId: 'T-028' }),
      ],
      rowCount: 1_240_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:00:00', upstream: ['CONFORMED_GOLD.DIM_PATIENT', 'CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.FCT_ENCOUNTER'], rowAccess: marketAccess,
      rows: memo(() => {
        const last = lastEncounter(d);
        return d.patients.map((p) => {
          const b = balances().get(p.key);
          return {
            MRN: p.mrn, PATIENT_NAME: `${p.first} ${p.last}`, BIRTH_DATE: p.dob, MARKET: p.market, HOME_HOSPITAL: hospByCode.get(p.homeHospital)!.name, PAYER_CLASS: payerOf(p.payerKey).payerClass,
            PRIMARY_PAYER: payerOf(p.payerKey).name, IS_ACTIVE: !p.deathDate && (last.get(p.key) ?? '') >= PERIODS.last12.from, PORTAL_ENROLLED: p.portal, RISK_SCORE: p.risk,
            LAST_ENCOUNTER_DATE: last.get(p.key) ?? null, OPEN_AR_BALANCE: round(b?.open ?? 0, 2), AGED_90_BALANCE: round(b?.aged ?? 0, 2),
          };
        });
      }),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_ENCOUNTERS_THROUGHPUT', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Encounters & Throughput',
      columns: [
        col('ENCOUNTER_ID', 'VARCHAR(16)', 'Encounter or appointment id', { termId: 'T-004', tags: ['CDE'] }), col('ENCOUNTER_TYPE', 'VARCHAR(12)', 'Inpatient / Emergency / Clinic'),
        col('FACILITY_NAME', 'VARCHAR(60)', 'Hospital or clinic'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }),
        col('SERVICE_LINE', 'VARCHAR(30)', 'Service line or clinic specialty', { termId: 'T-009' }), col('ENCOUNTER_DATE', 'DATE', 'Admission, arrival or appointment date'),
        col('DISCHARGE_DATE', 'DATE', 'Discharge date', { termId: 'T-030' }), col('LOS_DAYS', 'NUMBER(4)', 'Length of stay', { termId: 'T-005', tags: ['CDE'] }),
        col('ED_WAIT_MIN', 'NUMBER(5)', 'Door-to-provider minutes', { termId: 'T-011', tags: ['CDE'] }), col('LWBS_FLAG', 'BOOLEAN', 'Left without being seen', { termId: 'T-012' }),
        col('APPT_STATUS', 'VARCHAR(10)', 'Appointment status', { termId: 'T-013' }), col('LEAD_DAYS', 'NUMBER(4)', 'Booking-to-appointment days', { termId: 'T-014' }),
      ],
      rowCount: 77_786_668, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:14:00', upstream: ['CONFORMED_GOLD.FCT_ENCOUNTER', 'CONFORMED_GOLD.FCT_APPOINTMENT', 'CONFORMED_GOLD.DIM_FACILITY', 'CONFORMED_GOLD.DIM_CLINIC'], rowAccess: marketAccess,
      rows: memo(() => [
        ...d.stays.slice().reverse().map((s) => ({ ENCOUNTER_ID: s.id, ENCOUNTER_TYPE: 'Inpatient', FACILITY_NAME: hospByCode.get(s.hospitalCode)!.name, MARKET: s.market, SERVICE_LINE: s.serviceLine, ENCOUNTER_DATE: s.admit, DISCHARGE_DATE: s.inHouse ? null : s.discharge, LOS_DAYS: s.inHouse ? null : s.los, ED_WAIT_MIN: null, LWBS_FLAG: null, APPT_STATUS: null, LEAD_DAYS: null })),
        ...d.ed.slice().reverse().map((v) => ({ ENCOUNTER_ID: v.id, ENCOUNTER_TYPE: 'Emergency', FACILITY_NAME: hospByCode.get(v.hospitalCode)!.name, MARKET: v.market, SERVICE_LINE: 'Emergency', ENCOUNTER_DATE: v.date, DISCHARGE_DATE: v.date, LOS_DAYS: null, ED_WAIT_MIN: v.waitMin, LWBS_FLAG: v.lwbs, APPT_STATUS: null, LEAD_DAYS: null })),
        ...d.appts.slice().reverse().map((a) => ({ ENCOUNTER_ID: a.id, ENCOUNTER_TYPE: 'Clinic', FACILITY_NAME: d.clinics[a.clinicKey - 1].name, MARKET: a.market, SERVICE_LINE: a.specialty, ENCOUNTER_DATE: a.date, DISCHARGE_DATE: null, LOS_DAYS: null, ED_WAIT_MIN: null, LWBS_FLAG: null, APPT_STATUS: a.status, LEAD_DAYS: a.lag })),
      ]),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_REVENUE_CYCLE', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Revenue Cycle',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Claim id', { termId: 'T-015', tags: ['CDE'] }), col('PATIENT_MRN', 'VARCHAR(10)', 'Medical record number', { tags: ['PHI'] }),
        col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }), col('PAYER_NAME', 'VARCHAR(40)', 'Payer'), col('PAYER_CLASS', 'VARCHAR(12)', 'Payer class', { termId: 'T-020' }),
        col('ENCOUNTER_TYPE', 'VARCHAR(10)', 'IP / ED / OP'), col('SERVICE_DATE', 'DATE', 'Service date'), col('SUBMIT_DATE', 'DATE', 'Submission date'),
        col('EXPECTED_NET_USD', 'NUMBER(12,2)', 'Expected net reimbursement', { termId: 'T-019' }), col('IS_CLEAN', 'BOOLEAN', 'Clean claim', { termId: 'T-016', tags: ['CDE'] }),
        col('IS_DENIED', 'BOOLEAN', 'Initially denied', { termId: 'T-017', tags: ['CDE'] }), col('DENIAL_REASON', 'VARCHAR(30)', 'Denial category'), col('PAID_USD', 'NUMBER(12,2)', 'Paid to date'),
        col('OPEN_AR_USD', 'NUMBER(12,2)', 'Open A/R', { termId: 'T-018', tags: ['CDE'] }), col('DAYS_OUTSTANDING', 'NUMBER(4)', 'Days outstanding', { termId: 'T-028' }),
      ],
      rowCount: 104_880_412, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:00:00', upstream: ['CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.DIM_PAYER', 'CONFORMED_GOLD.DIM_PATIENT'], rowAccess: marketAccess,
      rows: memo(() => d.claims.slice().reverse().map((c) => {
        const open = c.resolvedDate > AS_OF;
        const py = payerOf(c.payerKey);
        return { CLAIM_ID: c.id, PATIENT_MRN: patByKey.get(c.patientKey)!.mrn, MARKET: c.market, PAYER_NAME: py.name, PAYER_CLASS: py.payerClass, ENCOUNTER_TYPE: c.encType, SERVICE_DATE: c.serviceDate, SUBMIT_DATE: c.submitDate, EXPECTED_NET_USD: c.expected, IS_CLEAN: c.clean, IS_DENIED: c.denied, DENIAL_REASON: c.denialReason, PAID_USD: open ? 0 : c.paid, OPEN_AR_USD: open ? c.expected : 0, DAYS_OUTSTANDING: open ? daysBetween(c.serviceDate, AS_OF) : null };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_QUALITY_READMISSIONS', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Quality & Readmissions',
      columns: [
        col('INDEX_STAY_ID', 'VARCHAR(16)', 'Index stay', { termId: 'T-007' }), col('FACILITY_NAME', 'VARCHAR(50)', 'Hospital'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003', tags: ['CDE'] }),
        col('SERVICE_LINE', 'VARCHAR(30)', 'Service line', { termId: 'T-009', tags: ['CDE'] }), col('DISCHARGE_DATE', 'DATE', 'Index discharge date', { termId: 'T-030' }), col('DISCHARGE_DISPOSITION', 'VARCHAR(24)', 'Disposition'),
        col('IS_ELIGIBLE_INDEX', 'BOOLEAN', 'Eligible index stay', { termId: 'T-007', tags: ['CDE'] }), col('READMIT_30D_FLAG', 'BOOLEAN', 'Unplanned 30-day readmission', { termId: 'T-006', tags: ['CDE'] }),
        col('PLANNED_READMIT_EXCLUDED', 'BOOLEAN', 'Planned readmission, not counted', { termId: 'T-008', tags: ['CDE'] }), col('DAYS_TO_READMIT', 'NUMBER(3)', 'Days to readmission'),
        col('FOLLOWUP_7D_FLAG', 'BOOLEAN', '7-day follow-up completed', { termId: 'T-022' }), col('EXPIRED_FLAG', 'BOOLEAN', 'In-hospital death', { termId: 'T-023' }),
      ],
      rowCount: 1_104_662, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:25:00', upstream: ['CONFORMED_GOLD.FCT_READMISSION', 'CONFORMED_GOLD.DIM_FACILITY'], rowAccess: marketAccess,
      rows: memo(() => d.stays.filter((s) => !s.inHouse).reverse().map((s) => {
        const f = flags().get(s.key)!;
        return {
          INDEX_STAY_ID: s.id, FACILITY_NAME: hospByCode.get(s.hospitalCode)!.name, MARKET: s.market, SERVICE_LINE: s.serviceLine, DISCHARGE_DATE: s.discharge, DISCHARGE_DISPOSITION: s.disposition,
          IS_ELIGIBLE_INDEX: f.eligible, READMIT_30D_FLAG: f.readmit, PLANNED_READMIT_EXCLUDED: f.plannedExcluded, DAYS_TO_READMIT: f.days ?? null,
          FOLLOWUP_7D_FLAG: ['Home', 'Home health'].includes(s.disposition) ? followed()(s.patientKey, s.discharge) : null, EXPIRED_FLAG: s.disposition === 'Expired',
        };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CLINICAL_SUPPLY_CHAIN', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Clinical Supply Chain (in certification)',
      columns: [
        col('USAGE_ID', 'VARCHAR(12)', 'Usage line'), col('ENCOUNTER_ID', 'VARCHAR(16)', 'Inpatient stay / surgical case', { termId: 'T-004' }),
        col('PATIENT_MRN', 'VARCHAR(10)', 'Medical record number (from FCT_SUPPLY_USAGE)', { tags: ['PHI'], maskPendingFix: GATE6_CHECK }),
        col('FACILITY_NAME', 'VARCHAR(50)', 'Hospital'), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('SERVICE_LINE', 'VARCHAR(30)', 'Service line', { termId: 'T-009' }),
        col('USAGE_DATE', 'DATE', 'Usage date'), col('ITEM_TYPE', 'VARCHAR(10)', 'Supply / Pharmacy'), col('CATEGORY', 'VARCHAR(30)', 'Category'), col('VENDOR', 'VARCHAR(40)', 'Vendor'),
        col('COST_USD', 'NUMBER(12,2)', 'Extended cost', { termId: 'T-029', tags: ['CDE'] }), col('ON_CONTRACT', 'BOOLEAN', 'On contract', { termId: 'T-025', tags: ['CDE'] }),
        col('IS_SURGICAL_CASE', 'BOOLEAN', 'Surgical case', { termId: 'T-024', tags: ['CDE'] }),
      ],
      rowCount: 86_420_118, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:15:00', upstream: ['CONFORMED_GOLD.FCT_SUPPLY_USAGE', 'CONFORMED_GOLD.FCT_ENCOUNTER', 'CONFORMED_GOLD.DIM_FACILITY'], rowAccess: marketAccess,
      rows: memo(() => d.supply.slice().reverse().map((l) => ({ USAGE_ID: l.id, ENCOUNTER_ID: l.encId, PATIENT_MRN: l.mrn, FACILITY_NAME: hospByCode.get(l.hospitalCode)!.name, MARKET: l.market, SERVICE_LINE: l.serviceLine, USAGE_DATE: l.date, ITEM_TYPE: l.itemType, CATEGORY: l.category, VENDOR: l.vendor, COST_USD: l.cost, ON_CONTRACT: l.onContract, IS_SURGICAL_CASE: l.surgical }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CARE_GAPS', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Care Gaps & Population Health (draft)',
      columns: [
        col('PATIENT_MRN', 'VARCHAR(10)', 'Medical record number', { tags: ['PHI'] }), col('MARKET', 'VARCHAR(10)', 'Hospital market', { termId: 'T-003' }), col('PCP_CLINIC', 'VARCHAR(60)', 'Attributed primary care clinic'),
        col('MEASURE', 'VARCHAR(50)', 'Quality measure (HEDIS-style)'), col('GAP_STATUS', 'VARCHAR(6)', 'Open / Closed', { termId: 'T-026', tags: ['CDE'] }), col('DUE_DATE', 'DATE', 'Measurement year end'),
        col('RISK_SCORE', 'NUMBER(5,2)', 'Patient risk score', { termId: 'T-021' }),
      ],
      rowCount: 1_288_400, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-28 02:00:00', upstream: ['CONFORMED_GOLD.DIM_PATIENT', 'CONFORMED_GOLD.FCT_APPOINTMENT', 'CURATED_SILVER.ENCOUNTER'], rowAccess: marketAccess,
      rows: memo(() => d.gaps.map((g) => { const p = patByKey.get(g.patientKey)!; return { PATIENT_MRN: p.mrn, MARKET: g.market, PCP_CLINIC: d.clinics[g.clinicKey - 1].name, MEASURE: g.measure, GAP_STATUS: g.status, DUE_DATE: g.dueDate, RISK_SCORE: p.risk }; })),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
