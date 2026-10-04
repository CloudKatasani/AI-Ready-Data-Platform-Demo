// Forgepoint Industries generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';
import { AS_OF_DATE } from '../shared/catalog-kit';

export const AS_OF = AS_OF_DATE;
/** Production, quality and maintenance history starts here (Q2 + Q3 2026, enough for quarter-over-quarter). */
export const WINDOW_START = '2026-04-01';
export const HEADCOUNT_TOTAL = 14_600;
export const ORDER_LINES_TOTAL = 61_200;

export const BUSINESS_UNITS = [
  { name: 'Motion Systems', code: 'MS' },
  { name: 'Fluid Power', code: 'FP' },
  { name: 'Industrial Controls', code: 'IC' },
  { name: 'Aerospace Components', code: 'AC' },
] as const;

export const BU_CODE_TO_NAME: Record<string, string> = { MS: 'Motion Systems', FP: 'Fluid Power', IC: 'Industrial Controls', AC: 'Aerospace Components' };

/** 22 plants across the four business units. Emission factor = location-based grid kg CO2e per kWh. */
export const PLANTS = [
  { code: 'DAY', name: 'Dayton', country: 'US', bu: 'MS', lines: 4, ef: 0.39 },
  { code: 'RFD', name: 'Rockford', country: 'US', bu: 'MS', lines: 4, ef: 0.39 },
  { code: 'GVL', name: 'Greenville', country: 'US', bu: 'MS', lines: 3, ef: 0.36 },
  { code: 'MTY', name: 'Monterrey', country: 'MX', bu: 'MS', lines: 4, ef: 0.42 },
  { code: 'BRN', name: 'Brno', country: 'CZ', bu: 'MS', lines: 3, ef: 0.45 },
  { code: 'PNQ', name: 'Pune', country: 'IN', bu: 'MS', lines: 4, ef: 0.71 },
  { code: 'SZH', name: 'Suzhou', country: 'CN', bu: 'MS', lines: 4, ef: 0.58 },
  { code: 'ELK', name: 'Elkhart', country: 'US', bu: 'FP', lines: 4, ef: 0.41 },
  { code: 'ICT', name: 'Wichita', country: 'US', bu: 'FP', lines: 3, ef: 0.43 },
  { code: 'JOI', name: 'Joinville', country: 'BR', bu: 'FP', lines: 4, ef: 0.09 },
  { code: 'LYS', name: 'Lyon', country: 'FR', bu: 'FP', lines: 3, ef: 0.05 },
  { code: 'MAA', name: 'Chennai', country: 'IN', bu: 'FP', lines: 4, ef: 0.71 },
  { code: 'WUX', name: 'Wuxi', country: 'CN', bu: 'FP', lines: 3, ef: 0.58 },
  { code: 'MKE', name: 'Milwaukee', country: 'US', bu: 'IC', lines: 4, ef: 0.44 },
  { code: 'RDU', name: 'Raleigh', country: 'US', bu: 'IC', lines: 4, ef: 0.33 },
  { code: 'GDL', name: 'Guadalajara', country: 'MX', bu: 'IC', lines: 3, ef: 0.42 },
  { code: 'EIN', name: 'Eindhoven', country: 'NL', bu: 'IC', lines: 4, ef: 0.33 },
  { code: 'PEN', name: 'Penang', country: 'MY', bu: 'IC', lines: 4, ef: 0.58 },
  { code: 'TUS', name: 'Tucson', country: 'US', bu: 'AC', lines: 3, ef: 0.37 },
  { code: 'HFD', name: 'Hartford', country: 'US', bu: 'AC', lines: 4, ef: 0.25 },
  { code: 'TLS', name: 'Toulouse', country: 'FR', bu: 'AC', lines: 3, ef: 0.05 },
  { code: 'QRO', name: 'Querétaro', country: 'MX', bu: 'AC', lines: 4, ef: 0.42 },
] as const;

/** Line types per business unit: ideal cycle time (s/unit), running and idle power (kW). */
export const LINE_TYPES: Record<string, { type: string; cycleSec: number; kwRun: number; kwIdle: number }[]> = {
  MS: [
    { type: 'CNC machining', cycleSec: 95, kwRun: 110, kwIdle: 30 }, { type: 'Gear hobbing', cycleSec: 60, kwRun: 85, kwIdle: 22 },
    { type: 'Motor assembly', cycleSec: 42, kwRun: 45, kwIdle: 12 }, { type: 'Test & pack', cycleSec: 30, kwRun: 28, kwIdle: 8 },
  ],
  FP: [
    { type: 'Valve machining', cycleSec: 110, kwRun: 120, kwIdle: 32 }, { type: 'Pump assembly', cycleSec: 75, kwRun: 52, kwIdle: 14 },
    { type: 'Hose crimping', cycleSec: 22, kwRun: 30, kwIdle: 9 }, { type: 'Pressure test', cycleSec: 48, kwRun: 40, kwIdle: 15 },
  ],
  IC: [
    { type: 'SMT placement', cycleSec: 14, kwRun: 65, kwIdle: 25 }, { type: 'Box build', cycleSec: 90, kwRun: 26, kwIdle: 8 },
    { type: 'Conformal coat', cycleSec: 26, kwRun: 48, kwIdle: 20 }, { type: 'Functional test', cycleSec: 60, kwRun: 22, kwIdle: 9 },
  ],
  AC: [
    { type: '5-axis machining', cycleSec: 620, kwRun: 140, kwIdle: 38 }, { type: 'Heat treat', cycleSec: 300, kwRun: 260, kwIdle: 120 },
    { type: 'NDT inspection', cycleSec: 240, kwRun: 35, kwIdle: 12 }, { type: 'Precision assembly', cycleSec: 420, kwRun: 30, kwIdle: 9 },
  ],
};

export const PRODUCT_FAMILIES: Record<string, { family: string; unitPrice: number; unitCost: number; quoteDays: number }[]> = {
  MS: [{ family: 'Servo motors', unitPrice: 640, unitCost: 402, quoteDays: 18 }, { family: 'Gearboxes', unitPrice: 910, unitCost: 588, quoteDays: 21 }, { family: 'Linear actuators', unitPrice: 420, unitCost: 251, quoteDays: 14 }],
  FP: [{ family: 'Hydraulic pumps', unitPrice: 1_280, unitCost: 803, quoteDays: 24 }, { family: 'Directional valves', unitPrice: 360, unitCost: 214, quoteDays: 16 }, { family: 'Hose assemblies', unitPrice: 48, unitCost: 27, quoteDays: 9 }],
  IC: [{ family: 'PLC modules', unitPrice: 520, unitCost: 296, quoteDays: 15 }, { family: 'Variable-speed drives', unitPrice: 1_150, unitCost: 702, quoteDays: 20 }, { family: 'HMI panels', unitPrice: 780, unitCost: 455, quoteDays: 17 }],
  AC: [{ family: 'Actuator housings', unitPrice: 4_800, unitCost: 3_150, quoteDays: 35 }, { family: 'Landing gear fittings', unitPrice: 9_400, unitCost: 6_020, quoteDays: 42 }, { family: 'Turbine brackets', unitPrice: 2_100, unitCost: 1_330, quoteDays: 30 }],
};

/** Order lateness probability by business unit (drives on-time delivery). */
export const LATE_PROB: Record<string, number> = { MS: 0.07, FP: 0.1, IC: 0.075, AC: 0.13 };

export const OTHER_DOWNTIME = ['Material shortage', 'Changeover overrun', 'Quality hold', 'Operator unavailable'] as const;
export const OTHER_DOWNTIME_WEIGHTS = [0.38, 0.32, 0.18, 0.12];
export const FAILURE_CAUSES = ['Spindle failure', 'Hydraulic leak', 'Sensor fault', 'Servo drive fault', 'Tooling breakage', 'Conveyor jam', 'Electrical fault'] as const;
export const DEFECT_CODES = ['Dimensional out of tolerance', 'Surface finish', 'Porosity', 'Leak test failure', 'Solder bridge', 'Wrong component', 'Burr / sharp edge', 'Torque out of spec'] as const;
export const DEFECT_WEIGHTS = [0.24, 0.13, 0.09, 0.12, 0.1, 0.07, 0.15, 0.1];

export const ASSET_TYPES: Record<string, string[]> = {
  MS: ['CNC lathe', 'Hobbing machine', 'Assembly robot', 'End-of-line tester', 'Conveyor'],
  FP: ['Machining centre', 'Assembly press', 'Crimping press', 'Hydrostatic test rig', 'Conveyor'],
  IC: ['Pick-and-place', 'Reflow oven', 'Coating robot', 'ICT tester', 'Conveyor'],
  AC: ['5-axis mill', 'Vacuum furnace', 'Ultrasonic scanner', 'Torque station', 'CMM'],
};

export const SUPPLIERS = [
  { name: 'Ardent Castings', category: 'Castings & forgings', country: 'US', otif: 0.91, ppm: 1_450, lead: 28 },
  { name: 'Brightwell Bearings', category: 'Bearings', country: 'DE', otif: 0.96, ppm: 310, lead: 21 },
  { name: 'Corvane Electronics', category: 'Electronic components', country: 'TW', otif: 0.86, ppm: 520, lead: 35 },
  { name: 'Delmar Seals & Gaskets', category: 'Seals', country: 'US', otif: 0.94, ppm: 880, lead: 14 },
  { name: 'Eastgate Fasteners', category: 'Fasteners', country: 'CN', otif: 0.93, ppm: 1_920, lead: 30 },
  { name: 'Fairhaven Alloys', category: 'Aerospace alloys', country: 'US', otif: 0.84, ppm: 260, lead: 45 },
  { name: 'Granton Hydraulics', category: 'Hydraulic fittings', country: 'IT', otif: 0.95, ppm: 640, lead: 24 },
  { name: 'Halden Motion Parts', category: 'Shafts & gears', country: 'MX', otif: 0.92, ppm: 1_100, lead: 18 },
  { name: 'Ironbridge Steel Service', category: 'Bar & plate', country: 'US', otif: 0.97, ppm: 150, lead: 10 },
  { name: 'Juniper PCB Works', category: 'Printed circuit boards', country: 'MY', otif: 0.89, ppm: 760, lead: 26 },
] as const;

export const CUSTOMER_PREFIX = ['Halvorsen', 'Brightline', 'Northgate', 'Kestrel', 'Meridian', 'Oakridge', 'Tallis', 'Varden', 'Corbel', 'Ashdown', 'Lindqvist', 'Renfield', 'Calloway', 'Sterling', 'Pinecrest', 'Marlowe', 'Quillon', 'Westbrook', 'Ostrander', 'Fenwick'];
export const CUSTOMER_SUFFIX = ['Robotics', 'Agri Equipment', 'Aerostructures', 'Packaging Systems', 'Mobile Hydraulics', 'Automation', 'Rail Systems', 'Marine', 'Medical Devices', 'Mining Equipment', 'Energy Systems', 'Material Handling'];

export const VOLUMES = { operators: 2000, customers: 120, orderLines: 6000, receipts: 3000, lotInspectProb: 0.3 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 62, max: 78 }, // OEE %
  { kpiId: 'K-02', min: 80, max: 92 }, // availability %
  { kpiId: 'K-03', min: 82, max: 94 }, // performance %
  { kpiId: 'K-04', min: 94, max: 99.5 }, // quality rate %
  { kpiId: 'K-05', min: 1_200_000, max: 3_000_000 }, // units produced per month
  { kpiId: 'K-06', min: 8_000, max: 20_000 }, // unplanned downtime hours per quarter
  { kpiId: 'K-07', min: 70, max: 82 }, // active production lines
  { kpiId: 'K-08', min: 90, max: 98 }, // first-pass yield %
  { kpiId: 'K-09', min: 1.5, max: 4.5 }, // scrap rate %
  { kpiId: 'K-10', min: 600, max: 3_000 }, // defects per million
  { kpiId: 'K-11', min: 150, max: 600 }, // nonconformances per quarter
  { kpiId: 'K-12', min: 600_000, max: 3_000_000 }, // cost of poor quality per quarter
  { kpiId: 'K-13', min: 0.8, max: 3 }, // rework rate %
  { kpiId: 'K-14', min: 150, max: 600 }, // MTBF hours
  { kpiId: 'K-15', min: 1.5, max: 6 }, // MTTR hours
  { kpiId: 'K-16', min: 70, max: 92 }, // planned maintenance %
  { kpiId: 'K-17', min: 800, max: 2_500 }, // unplanned failures per quarter
  { kpiId: 'K-18', min: 85, max: 97 }, // supplier OTIF %
  { kpiId: 'K-19', min: 200, max: 2_500 }, // supplier PPM
  { kpiId: 'K-20', min: 10, max: 40 }, // supplier lead time days
  { kpiId: 'K-21', min: 85, max: 97 }, // on-time delivery %
  { kpiId: 'K-22', min: 8, max: 35 }, // order lead time days
  { kpiId: 'K-23', min: 93, max: 99.5 }, // order fill rate %
  { kpiId: 'K-24', min: 7_000, max: 14_000 }, // order lines shipped per month (scaled)
  { kpiId: 'K-25', min: 0.3, max: 3 }, // energy per unit kWh
  { kpiId: 'K-26', min: 1_500, max: 6_000 }, // scope 2 tCO2e per quarter
];
