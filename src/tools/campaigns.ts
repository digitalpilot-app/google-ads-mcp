import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { conversionRateFromMetrics, microsToUnits } from '../metrics-helpers.js';
import { customerIdOptional } from '../schema-common.js';

export const listCampaignsSchema = z.object({
  limit: z.number().optional().default(50),
  includeRemoved: z.boolean().optional().default(false),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_14_DAYS',
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH',
    'THIS_QUARTER',
    'LAST_QUARTER',
    'THIS_YEAR',
    'LAST_YEAR',
    'ALL_TIME',
    'CUSTOM'
  ]).optional().default('ALL_TIME'),
  customDateRange: z.object({
    startDate: z.string().describe('YYYY-MM-DD format'),
    endDate: z.string().describe('YYYY-MM-DD format'),
  }).optional(),
}).merge(customerIdOptional);

export const getCampaignSchema = z.object({
  campaignId: z.string(),
}).merge(customerIdOptional);

export const createCampaignSchema = z.object({
  name: z.string(),
  budget: z.number(),
  advertisingChannelType: z.enum(['SEARCH', 'DISPLAY', 'SHOPPING', 'VIDEO', 'MULTI_CHANNEL']),
  status: z.enum(['ENABLED', 'PAUSED']).optional().default('PAUSED'),
}).merge(customerIdOptional);

export const updateCampaignSchema = z.object({
  campaignId: z.string(),
  name: z.string().optional(),
  status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']).optional(),
  budget: z.number().optional(),
}).merge(customerIdOptional);

export async function listCampaigns(params: z.infer<typeof listCampaignsSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  // Build WHERE clause
  let whereConditions = [];
  
  if (!params.includeRemoved) {
    whereConditions.push('campaign.status != "REMOVED"');
  }
  
  // Add date filter
  if (params.dateRange !== 'ALL_TIME') {
    if (params.dateRange === 'CUSTOM' && params.customDateRange) {
      whereConditions.push(`segments.date BETWEEN '${params.customDateRange.startDate}' AND '${params.customDateRange.endDate}'`);
    } else {
      whereConditions.push(`segments.date DURING ${params.dateRange}`);
    }
  }
  
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion
    FROM campaign
    ${whereClause}
    ORDER BY campaign.id
    LIMIT ${params.limit}
  `;

  const campaigns = await customer.query(query);
  
  return campaigns.map((campaign: any) => ({
    id: campaign.campaign.id,
    name: campaign.campaign.name,
    status: campaign.campaign.status,
    type: campaign.campaign.advertising_channel_type,
    startDate: campaign.campaign.start_date,
    endDate: campaign.campaign.end_date,
    budget: campaign.campaign_budget?.amount_micros != null
      ? microsToUnits(campaign.campaign_budget.amount_micros)
      : null,
    dateRange: params.dateRange,
    metrics: {
      impressions: campaign.metrics?.impressions || 0,
      clicks: campaign.metrics?.clicks || 0,
      cost: campaign.metrics?.cost_micros != null ? microsToUnits(campaign.metrics.cost_micros) : 0,
      conversions: campaign.metrics?.conversions || 0,
      ctr: campaign.metrics?.ctr || 0,
      avgCpc: campaign.metrics?.average_cpc || 0,
      conversionRate: conversionRateFromMetrics(campaign.metrics),
      costPerConversion: campaign.metrics?.cost_per_conversion || 0,
    }
  }));
}

export async function getCampaign(params: z.infer<typeof getCampaignSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign.serving_status,
      campaign.optimization_score,
      campaign_budget.amount_micros,
      campaign_budget.delivery_method,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
  `;

  const [campaign] = await customer.query(query);
  
  if (!campaign) {
    throw new Error(`Campaign with ID ${params.campaignId} not found`);
  }

  return {
    id: campaign.campaign.id,
    name: campaign.campaign.name,
    status: campaign.campaign.status,
    servingStatus: campaign.campaign.serving_status,
    type: campaign.campaign.advertising_channel_type,
    startDate: campaign.campaign.start_date,
    endDate: campaign.campaign.end_date,
    optimizationScore: campaign.campaign.optimization_score,
    budget: {
      amount: campaign.campaign_budget?.amount_micros != null
        ? microsToUnits(campaign.campaign_budget.amount_micros)
        : null,
      deliveryMethod: campaign.campaign_budget?.delivery_method,
    },
    metrics: {
      impressions: campaign.metrics?.impressions || 0,
      clicks: campaign.metrics?.clicks || 0,
      cost: campaign.metrics?.cost_micros != null ? microsToUnits(campaign.metrics.cost_micros) : 0,
      conversions: campaign.metrics?.conversions || 0,
      ctr: campaign.metrics?.ctr || 0,
      avgCpc: campaign.metrics?.average_cpc || 0,
      conversionRate: conversionRateFromMetrics(campaign.metrics),
    }
  };
}

export async function createCampaign(params: z.infer<typeof createCampaignSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  const budgetResp = await customer.campaignBudgets.create([
    {
      name: `Budget for ${params.name}`,
      amount_micros: params.budget * 1_000_000,
      delivery_method: 'STANDARD',
    },
  ]);

  const budgetRn = budgetResp.results?.[0]?.resource_name;
  if (!budgetRn) {
    throw new Error('Campaign budget create returned no resource_name');
  }

  const campaignResp = await customer.campaigns.create([
    {
      name: params.name,
      status: params.status,
      advertising_channel_type: params.advertisingChannelType,
      campaign_budget: budgetRn,
    },
  ]);

  const campResult = campaignResp.results?.[0];
  const campaignId =
    campResult?.campaign?.id?.toString() ??
    campResult?.resource_name?.split('/').pop();

  return {
    id: campaignId,
    resourceName: campResult?.resource_name,
    name: params.name,
    status: params.status,
    budget: params.budget,
  };
}

export async function updateCampaign(params: z.infer<typeof updateCampaignSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  const updates: any = {};
  
  if (params.name !== undefined) {
    updates.name = params.name;
  }
  
  if (params.status !== undefined) {
    updates.status = params.status;
  }
  
  if (params.budget !== undefined) {
    const campaignQuery = `
      SELECT campaign_budget.resource_name
      FROM campaign
      WHERE campaign.id = ${params.campaignId}
    `;
    const [campaign] = await customer.query(campaignQuery);
    
    if (campaign?.campaign_budget?.resource_name) {
      await customer.campaignBudgets.update([
        {
          resource_name: campaign.campaign_budget.resource_name,
          amount_micros: params.budget * 1_000_000,
        },
      ]);
    }
  }
  
  if (Object.keys(updates).length > 0) {
    await customer.campaigns.update([
      {
        resource_name: `customers/${customer.credentials.customer_id}/campaigns/${params.campaignId}`,
        ...updates,
      },
    ]);
  }
  
  return { success: true, campaignId: params.campaignId };
}

export const campaignTools: Tool[] = [
  {
    name: 'list_campaigns',
    description: 'List all Google Ads campaigns with their metrics for a specific date range',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of campaigns to return' },
        includeRemoved: { type: 'boolean', description: 'Include removed campaigns' },
        dateRange: { 
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'THIS_QUARTER', 'LAST_QUARTER', 'THIS_YEAR', 'LAST_YEAR', 'ALL_TIME', 'CUSTOM'],
          description: 'Date range for metrics (default: ALL_TIME)' 
        },
        customDateRange: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
            endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' }
          },
          required: ['startDate', 'endDate'],
          description: 'Custom date range (only used when dateRange is CUSTOM)'
        },
      },
    },
  },
  {
    name: 'get_campaign',
    description: 'Get detailed information about a specific campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Campaign ID' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'create_campaign',
    description: 'Create a new Google Ads campaign',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        budget: { type: 'number', description: 'Daily budget in account currency' },
        advertisingChannelType: { 
          type: 'string', 
          enum: ['SEARCH', 'DISPLAY', 'SHOPPING', 'VIDEO', 'MULTI_CHANNEL'],
          description: 'Campaign type' 
        },
        status: { 
          type: 'string',
          enum: ['ENABLED', 'PAUSED'],
          description: 'Campaign status' 
        },
      },
      required: ['name', 'budget', 'advertisingChannelType'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update an existing campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Campaign ID' },
        name: { type: 'string', description: 'New campaign name' },
        status: { 
          type: 'string',
          enum: ['ENABLED', 'PAUSED', 'REMOVED'],
          description: 'New campaign status' 
        },
        budget: { type: 'number', description: 'New daily budget' },
      },
      required: ['campaignId'],
    },
  },
];