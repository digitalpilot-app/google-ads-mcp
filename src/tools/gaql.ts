import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { customerIdOptional } from '../schema-common.js';
import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_NODE_PACKAGE_VERSION } from '../google-ads-version.js';

export const runGaqlSchema = z
  .object({
    /** Full GAQL query string (SELECT … FROM … WHERE …). */
    query: z.string().min(1),
    /**
     * When set, uses paginated Search with this page size instead of searchStream.
     * Useful for queries incompatible with streaming. The client may still follow pages until exhausted.
     */
    pageSize: z.number().int().positive().optional(),
    returnTotalResultsCount: z.boolean().optional().describe('If true, response may include totalResultsCount (uses paginated Search).'),
    returnSummaryRow: z.boolean().optional().describe('If true, ask API for a summary row when applicable.'),
  })
  .merge(customerIdOptional);

export async function runGaql(params: z.infer<typeof runGaqlSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  const requestOptions: Record<string, unknown> = {};
  if (params.pageSize !== undefined) {
    requestOptions.page_size = params.pageSize;
  }
  if (params.returnTotalResultsCount !== undefined || params.returnSummaryRow !== undefined) {
    requestOptions.search_settings = {
      ...(params.returnTotalResultsCount !== undefined && {
        return_total_results_count: params.returnTotalResultsCount,
      }),
      ...(params.returnSummaryRow !== undefined && { return_summary_row: params.returnSummaryRow }),
    };
  }
  const rows = await customer.query(params.query.trim(), requestOptions);
  return {
    googleAdsApiVersion: GOOGLE_ADS_API_VERSION,
    googleAdsNodePackageVersion: GOOGLE_ADS_NODE_PACKAGE_VERSION,
    rowCount: Array.isArray(rows) ? rows.length : 0,
    results: rows,
  };
}
