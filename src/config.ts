import { config } from 'dotenv';
import { z } from 'zod';

// Only load .env in development, not when run as MCP server
if (!process.env.GOOGLE_ADS_CLIENT_ID) {
  // Suppress dotenv console output
  const originalLog = console.log;
  console.log = () => {};
  config();
  console.log = originalLog;
}

const configSchema = z.object({
  clientId: z.string().min(1, 'GOOGLE_ADS_CLIENT_ID is required'),
  clientSecret: z.string().min(1, 'GOOGLE_ADS_CLIENT_SECRET is required'),
  developerToken: z.string().min(1, 'GOOGLE_ADS_DEVELOPER_TOKEN is required'),
  refreshToken: z.string().min(1, 'GOOGLE_ADS_REFRESH_TOKEN is required'),
  /** Default account when tools omit customerId. Optional if every call passes customerId. */
  customerId: z.string().optional(),
  loginCustomerId: z.string().optional(),
});

export const googleAdsConfig = configSchema.parse({
  clientId: process.env.GOOGLE_ADS_CLIENT_ID,
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  customerId: process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/\D/g, '') || undefined,
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, '') || undefined,
});