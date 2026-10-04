import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'healthcare', industry: 'Healthcare', company: 'Crestview Health System', dbPrefix: 'CVH', account: 'CVH_PROD',
  tagline: 'Integrated delivery network of 14 hospitals and 210 clinics across four hospital markets.',
  scale: [{ label: 'Hospitals', value: '14' }, { label: 'Clinics', value: '210' }, { label: 'Patients', value: '1.24 M' }],
  regions: ['North', 'Central', 'Coastal', 'Valley'], icon: 'cross', accent: '#E04F5F', seed: BASE_SEED + 5,
  sources: [
    { name: 'EHR (ADT, encounters)', system: 'Registration, admissions, discharges, transfers and ED encounters (HL7 ADT → CDC)' },
    { name: 'Claims & remits (837/835)', system: 'Billed claims (837I/837P) and remittance advice (835) from the clearinghouse' },
    { name: 'Scheduling', system: 'Clinic appointments, slots and visit status' },
    { name: 'Pharmacy', system: 'Inpatient dispenses and formulary' },
    { name: 'Supply chain', system: 'Item master, point-of-use supply capture and contracts' },
    { name: 'Documents', system: 'HIPAA minimum necessary, CMS measure specs, readmission definitions' },
  ],
  headlineKpis: ['30-day readmission rate', 'Average length of stay', 'Days in A/R'], sensitiveClasses: ['PHI'], ready: false,
};
