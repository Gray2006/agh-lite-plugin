import { auditHome, renderReport } from '../lib/audit.js';

process.stdout.write(renderReport(auditHome(undefined, { days: 30 })));
