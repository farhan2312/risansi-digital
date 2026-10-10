// Generates public/pump_upload_template.xlsx — the download template for the
// admin "Pump Ingestion" page. Matches the EC/Serial ERP export format
// (one row per pump serial). Re-run after changing the columns.
//   node scripts/make-pump-template.mjs
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'pump_upload_template.xlsx');

const headers = [
  'CUST', 'CUST_NAME', 'EC_NO', 'SO_NO', 'PUMP_SL_NO',
  'PUMP_MODEL_AS_NAME_PLATE', 'LIQUID', 'CAPACITY', 'HEAD',
];

// One illustrative row. CUST is the ERP customer code (reversed to the portal
// client code on import). An unknown code is safely skipped on upload.
const example = [
  'A00101HOSH', 'A. B. SUGARS LTD', 'EC/26/1/180/37619', 'SO26/1/180', '25-26/1/1188',
  'RMOH81100AABN', 'A Heavy Molasses', '50 m3/hr', '60 MWC',
];

const ws = XLSX.utils.aoa_to_sheet([headers, example]);
ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length + 2, i === 1 || i === 5 ? 24 : 12) }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Pumps');
XLSX.writeFile(wb, OUT);
console.log('Wrote', OUT);
