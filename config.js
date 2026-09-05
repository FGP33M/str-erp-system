// Configuration for ERP System
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  SERVICE_ACCOUNT_KEY_PATH: process.env.SERVICE_ACCOUNT_KEY_PATH || (typeof __dirname !== 'undefined' ? path.join(__dirname, 'str-erp-system-b07e6bc9c3da.json') : './str-erp-system-b07e6bc9c3da.json'),
  
  // Google Spreadsheet IDs
  SHEETS: {
    AUTH: process.env.AUTH_SHEET_ID || '1uM237XywBb0lFa9wavSP-rxNEOYUQldJp7AnLX09uM8',
    PRODUCTS: process.env.PRODUCT_SHEET_ID || '1pCuUFizx8K2VTjMGGXB4MYfVJQndIFseky_gKuzApPg',
    ACCOUNTING: process.env.ACCOUNT_SHEET_ID || '10jTkGZMirCg8Pb3FsRGP_6LLiDbl8K4rmkZ31tCNSwY',
    CUSTOMERS: process.env.CUSTOMERS_SHEET_ID || '1GvHnGGIrUt_H7sMlhwvG_u8jJQozVhzDQjl6G_GX1j4',
    DELIVERY_MASTER: process.env.DELIVERY_MASTER_SHEET_ID || '1DVGGWYvzTWRFtHgrm1fcgaXhk7luFYQu6myBBLLjYus',
    STRMREC: process.env.STRMREC_SHEET_ID || '19c8yjaRbxejRHMmRA-f4ZDiqwlp2_2rCf2dFAe4736Q',
    DAILY_RECEIPTS: process.env.DAILY_RECEIPTS_SHEET_ID || '1tlQMwfTzdPQ4H1htkEUcWy7YBXfJ6UB59YvorAv0tGs',
  },

  // Google Drive Folder for Bill Photos
  DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || '1oI1qQSuC83v8GVnIR7J-YCGbUer3wnv3',

  // Cache duration in milliseconds (5 minutes)
  CACHE_TTL_MS: 5 * 60 * 1000,

  // JWT Secret
  JWT_SECRET: process.env.JWT_SECRET || 'erp_str_super_secret_jwt_key_2026'
};
