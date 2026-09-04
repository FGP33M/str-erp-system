// Configuration for ERP System
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  SERVICE_ACCOUNT_KEY_PATH: process.env.SERVICE_ACCOUNT_KEY_PATH || path.join(__dirname, 'str-erp-system-b07e6bc9c3da.json'),
  
  // Google Spreadsheet IDs
  SHEETS: {
    AUTH: process.env.AUTH_SHEET_ID || '1uM237XywBb0lFa9wavSP-rxNEOYUQldJp7AnLX09uM8',
    PRODUCTS: process.env.PRODUCT_SHEET_ID || '1pCuUFizx8K2VTjMGGXB4MYfVJQndIFseky_gKuzApPg',
    ACCOUNTING: process.env.ACCOUNT_SHEET_ID || '10jTkGZMirCg8Pb3FsRGP_6LLiDbl8K4rmkZ31tCNSwY',
  },

  // Cache duration in milliseconds (5 minutes)
  CACHE_TTL_MS: 5 * 60 * 1000,

  // JWT Secret
  JWT_SECRET: process.env.JWT_SECRET || 'erp_str_super_secret_jwt_key_2026'
};
