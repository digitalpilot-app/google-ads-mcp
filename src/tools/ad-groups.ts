import { z } from 'zod';
import { resources } from 'google-ads-api';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { customerIdOptional } from '../schema-common.js';
import { throwGoogleAdsMutateError } from '../google-ads-error.js';

export const listAdGroupsSchema = z.object({
  campaignId: z.string().optional(),
  limit: z.number().optional().default(100),
  includeRemoved: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const createAdGroupSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  status: z.enum(['ENABLED', 'PAUSED']).optional().default('ENABLED'),
  cpcBidMicros: z.number().optional(),
  cpmBidMicros: z.number().optional(),
  targetCpaMicros: z.number().optional(),
  targetRoas: z.number().optional(),
}).merge(customerIdOptional);

export const updateAdGroupSchema = z.object({
  adGroupId: z.string(),
  name: z.string().optional(),
  status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']).optional(),
  cpcBidMicros: z.number().optional(),
  cpmBidMicros: z.number().optional(),
  targetCpaMicros: z.number().optional(),
  targetRoas: z.number().optional(),
}).merge(customerIdOptional);

export const getAdGroupSchema = z.object({
  adGroupId: z.string(),
}).merge(customerIdOptional);

function microsToNumber(micros: string | number | undefined): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  return Number(micros) / 1_000_000;
}

export async function listAdGroups(args: z.infer<typeof listAdGroupsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    let query = `
      SELECT 
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.campaign,
        ad_group.cpc_bid_micros,
        ad_group.cpm_bid_micros,
        ad_group.target_cpa_micros,
        ad_group.target_roas,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group
    `;
    
    const conditions = [];
    
    if (args.campaignId) {
      conditions.push(`campaign.id = ${args.campaignId}`);
    }
    
    if (!args.includeRemoved) {
      conditions.push(`ad_group.status != 'REMOVED'`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY ad_group.id DESC LIMIT ${args.limit}`;
    
    const response = await client.query(query);
    
    return response.map(row => ({
      id: row.ad_group?.id,
      name: row.ad_group?.name,
      status: row.ad_group?.status,
      campaignId: row.ad_group?.campaign?.split('/').pop(),
      campaignName: row.campaign?.name,
      cpcBidMicros: row.ad_group?.cpc_bid_micros,
      cpmBidMicros: row.ad_group?.cpm_bid_micros,
      targetCpaMicros: row.ad_group?.target_cpa_micros,
      targetRoas: row.ad_group?.target_roas,
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        conversionsValue: microsToNumber(row.metrics?.conversions_value) || 0,
      }
    }));
  } catch (error) {
    throw new Error(`Failed to list ad groups: ${error.message}`);
  }
}

export async function createAdGroup(args: z.infer<typeof createAdGroupSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const cid = client.credentials.customer_id;
    const response = await client.adGroups.create([
      {
        campaign: `customers/${cid}/campaigns/${args.campaignId}`,
        name: args.name,
        status: args.status,
        cpc_bid_micros: args.cpcBidMicros,
        cpm_bid_micros: args.cpmBidMicros,
        target_cpa_micros: args.targetCpaMicros,
        target_roas: args.targetRoas,
      },
    ]);
    
    const result = response.results?.[0];
    const adGroupId = result?.resource_name?.split('/').pop();
    
    return {
      success: true,
      adGroupId,
      resourceName: result?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'create_ad_group',
        action: 'Failed to create ad group',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function updateAdGroup(args: z.infer<typeof updateAdGroupSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const cid = client.credentials.customer_id;
    const updateObject: Record<string, unknown> = {
      resource_name: `customers/${cid}/adGroups/${args.adGroupId}`,
    };
    
    if (args.name !== undefined) {
      updateObject.name = args.name;
    }
    
    if (args.status !== undefined) {
      updateObject.status = args.status;
    }
    
    if (args.cpcBidMicros !== undefined) {
      updateObject.cpc_bid_micros = args.cpcBidMicros;
    }
    
    if (args.cpmBidMicros !== undefined) {
      updateObject.cpm_bid_micros = args.cpmBidMicros;
    }
    
    if (args.targetCpaMicros !== undefined) {
      updateObject.target_cpa_micros = args.targetCpaMicros;
    }
    
    if (args.targetRoas !== undefined) {
      updateObject.target_roas = args.targetRoas;
    }
    
    const response = await client.adGroups.update([updateObject as resources.IAdGroup]);
    
    return {
      success: true,
      resourceName: response.results?.[0]?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'update_ad_group',
        action: 'Failed to update ad group',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function getAdGroup(args: z.infer<typeof getAdGroupSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const query = `
      SELECT 
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.campaign,
        ad_group.cpc_bid_micros,
        ad_group.cpm_bid_micros,
        ad_group.target_cpa_micros,
        ad_group.target_roas,
        ad_group.effective_target_cpa_micros,
        ad_group.effective_target_roas,
        campaign.name,
        campaign.id
      FROM ad_group
      WHERE ad_group.id = ${args.adGroupId}
    `;
    
    const response = await client.query(query);
    
    if (response.length === 0) {
      throw new Error('Ad group not found');
    }
    
    const row = response[0];
    
    return {
      id: row.ad_group?.id,
      name: row.ad_group?.name,
      status: row.ad_group?.status,
      campaignId: row.campaign?.id,
      campaignName: row.campaign?.name,
      cpcBidMicros: row.ad_group?.cpc_bid_micros,
      cpmBidMicros: row.ad_group?.cpm_bid_micros,
      targetCpaMicros: row.ad_group?.target_cpa_micros,
      targetRoas: row.ad_group?.target_roas,
      effectiveTargetCpaMicros: row.ad_group?.effective_target_cpa_micros,
      effectiveTargetRoas: row.ad_group?.effective_target_roas,
    };
  } catch (error) {
    throw new Error(`Failed to get ad group: ${error.message}`);
  }
}

export const adGroupTools: Tool[] = [
  {
    name: 'list_ad_groups',
    description: 'List ad groups with their performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Filter by campaign ID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of ad groups to return',
        },
        includeRemoved: {
          type: 'boolean',
          description: 'Include removed ad groups',
        },
      },
    },
  },
  {
    name: 'create_ad_group',
    description: 'Create a new ad group in a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Campaign ID where the ad group will be created',
        },
        name: {
          type: 'string',
          description: 'Name of the ad group',
        },
        status: {
          type: 'string',
          enum: ['ENABLED', 'PAUSED'],
          description: 'Initial status of the ad group',
        },
        cpcBidMicros: {
          type: 'number',
          description: 'Cost per click bid in micros (1 million = 1 currency unit)',
        },
        cpmBidMicros: {
          type: 'number',
          description: 'Cost per thousand impressions bid in micros',
        },
        targetCpaMicros: {
          type: 'number',
          description: 'Target cost per acquisition in micros',
        },
        targetRoas: {
          type: 'number',
          description: 'Target return on ad spend',
        },
      },
      required: ['campaignId', 'name'],
    },
  },
  {
    name: 'update_ad_group',
    description: 'Update an existing ad group',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: {
          type: 'string',
          description: 'Ad group ID to update',
        },
        name: {
          type: 'string',
          description: 'New name for the ad group',
        },
        status: {
          type: 'string',
          enum: ['ENABLED', 'PAUSED', 'REMOVED'],
          description: 'New status for the ad group',
        },
        cpcBidMicros: {
          type: 'number',
          description: 'New CPC bid in micros',
        },
        cpmBidMicros: {
          type: 'number',
          description: 'New CPM bid in micros',
        },
        targetCpaMicros: {
          type: 'number',
          description: 'New target CPA in micros',
        },
        targetRoas: {
          type: 'number',
          description: 'New target ROAS',
        },
      },
      required: ['adGroupId'],
    },
  },
  {
    name: 'get_ad_group',
    description: 'Get detailed information about a specific ad group',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: {
          type: 'string',
          description: 'Ad group ID',
        },
      },
      required: ['adGroupId'],
    },
  },
];