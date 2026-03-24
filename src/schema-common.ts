import { z } from 'zod';

/** Per-request Google Ads account id (digits only; dashes stripped). Falls back to GOOGLE_ADS_CUSTOMER_ID when omitted. */
export const customerIdOptional = z.object({
  customerId: z.string().optional(),
});
