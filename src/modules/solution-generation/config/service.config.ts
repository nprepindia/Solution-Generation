
// Internal Service Configuration
// Environment-based configuration for external services and APIs

// OpenAI Configuration
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Google AI Configuration
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

// Supabase Configuration  
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// PostgreSQL Vector Store Configuration
export const POSTGRES_VECTOR_STORE_URL = process.env.POSTGRES_VECTOR_STORE_URL || '';

// NPrep API Configuration
export const NPREP_API_BEARER_TOKEN = process.env.NPREP_API_BEARER_TOKEN || '';

// Service URLs and Endpoints
export const SERVICE_BASE_URL = process.env.SERVICE_BASE_URL || 'https://services.nprep.in/webhook';

// Legacy token (consider migrating to NPREP_API_BEARER_TOKEN)
export const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbl9pZCI6MSwiaWF0IjoxNzQ4MjU2NjIzfQ.o1mQdWI4RINIJKxi6vgt5jSJoOe1A0jiaCy-YbqxNws';

// Configuration validation helper
export const validateServiceConfig = (): { isValid: boolean; missing: string[] } => {
  const requiredConfigs = [
    { key: 'OPENAI_API_KEY', value: OPENAI_API_KEY },
    { key: 'GOOGLE_API_KEY', value: GOOGLE_API_KEY },
    { key: 'POSTGRES_VECTOR_STORE_URL', value: POSTGRES_VECTOR_STORE_URL },
    { key: 'NPREP_API_BEARER_TOKEN', value: NPREP_API_BEARER_TOKEN },
  ];

  const missing = requiredConfigs
    .filter(config => !config.value || config.value.trim() === '')
    .map(config => config.key);

  return {
    isValid: missing.length === 0,
    missing,
  };
};
