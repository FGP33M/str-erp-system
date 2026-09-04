/**
 * Smart Details Parser for Product Database
 * Decodes: หน่วย/จำนวนต่อแพ็คเกจ F,จำนวนสต็อกสูงสุด L,ที่เก็บ D,รับเข้าล่าสุด
 */
function parseProductDetails(raw) {
  if (!raw || typeof raw !== 'string') {
    return {
      unit: '-',
      packQty: '',
      maxStock: '',
      location: '',
      lastReceived: '',
      notes: '',
      raw: ''
    };
  }
  
  const str = raw.trim();
  let unit = '';
  let packQty = '';
  let maxStock = '';
  let location = '';
  let lastReceived = '';
  let notes = '';

  // Extract D, or embedded date (e.g. 24/12/61 or 18/3/67)
  const dMatch = str.match(/D,([^, FLC]+)/i);
  if (dMatch) {
    lastReceived = dMatch[1].trim();
  } else {
    const dateMatch = str.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dateMatch) {
      lastReceived = dateMatch[1];
    }
  }

  // Extract F, (Max stock / Floor)
  const fMatch = str.match(/F,([^, LDC]+)/i);
  if (fMatch) {
    maxStock = fMatch[1].trim();
  }

  // Extract L, (Location / Shelf)
  const lMatch = str.match(/L,([^, FDC]+)/i);
  if (lMatch) {
    location = lMatch[1].trim();
  }

  // Extract C, (Code / Cost note)
  const cMatch = str.match(/C,([^, FDL]+)/i);
  if (cMatch) {
    notes = cMatch[1].trim();
  }

  // Extract Unit & Pack Qty by stripping out F, L, D, C and date patterns
  let clean = str
    .replace(/F,[^, LDC]*/gi, '')
    .replace(/L,[^, FDC]*/gi, '')
    .replace(/D,[^, FLC]*/gi, '')
    .replace(/C,[^, FDL]*/gi, '')
    .replace(/(\d{1,2}\/\d{1,2}\/\d{2,4})/g, '')
    .replace(/,\s*/g, ' ')
    .trim();

  if (clean.includes('/')) {
    const parts = clean.split('/');
    unit = parts[0].trim();
    packQty = parts.slice(1).join('/').trim();
  } else {
    unit = clean || '-';
  }

  return {
    unit: unit || '-',
    packQty,
    maxStock,
    location,
    lastReceived,
    notes,
    raw: str
  };
}

module.exports = { parseProductDetails };
