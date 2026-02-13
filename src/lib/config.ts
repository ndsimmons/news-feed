// API Configuration
// Use environment variable or fallback to production API

export const API_BASE_URL = 
  import.meta.env.PUBLIC_API_URL || 
  'https://news-feed-api.nsimmons.workers.dev';
