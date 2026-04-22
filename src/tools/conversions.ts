import { z } from 'zod';
import { resources } from 'google-ads-api';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { customerIdOptional } from '../schema-common.js';
import { throwGoogleAdsMutateError } from '../google-ads-error.js';

export const listConversionActionsSchema = z.object({
  includeRemoved: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const createConversionActionSchema = z.object({
  name: z.string(),
  category: z.enum([
    'PURCHASE',
    'SIGNUP',
    'LEAD',
    'PAGE_VIEW',
    'DOWNLOAD',
    'OTHER'
  ]),
  type: z.enum(['WEBPAGE', 'UPLOAD_CLICKS', 'AD_CALL', 'APP_DOWNLOAD']).optional().default('WEBPAGE'),
  status: z.enum(['ENABLED', 'REMOVED', 'HIDDEN']).optional().default('ENABLED'),
  valueSettings: z.object({
    defaultValue: z.number().optional(),
    defaultCurrencyCode: z.string().optional(),
    alwaysUseDefaultValue: z.boolean().optional().default(false),
  }).optional(),
  countingType: z.enum(['ONE_PER_CLICK', 'MANY_PER_CLICK']).optional().default('ONE_PER_CLICK'),
  attributionModel: z.enum(['EXTERNAL', 'GOOGLE_ADS_LAST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_FIRST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_LINEAR', 'GOOGLE_SEARCH_ATTRIBUTION_TIME_DECAY', 'GOOGLE_SEARCH_ATTRIBUTION_POSITION_BASED', 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN']).optional().default('GOOGLE_ADS_LAST_CLICK'),
  clickThroughLookbackWindowDays: z.number().optional().default(30),
  viewThroughLookbackWindowDays: z.number().optional().default(1),
}).merge(customerIdOptional);

export const updateConversionActionSchema = z.object({
  conversionActionId: z.string(),
  name: z.string().optional(),
  status: z.enum(['ENABLED', 'REMOVED', 'HIDDEN']).optional(),
  valueSettings: z.object({
    defaultValue: z.number().optional(),
    defaultCurrencyCode: z.string().optional(),
    alwaysUseDefaultValue: z.boolean().optional(),
  }).optional(),
  countingType: z.enum(['ONE_PER_CLICK', 'MANY_PER_CLICK']).optional(),
  attributionModel: z.enum(['EXTERNAL', 'GOOGLE_ADS_LAST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_FIRST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_LINEAR', 'GOOGLE_SEARCH_ATTRIBUTION_TIME_DECAY', 'GOOGLE_SEARCH_ATTRIBUTION_POSITION_BASED', 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN']).optional(),
  clickThroughLookbackWindowDays: z.number().optional(),
  viewThroughLookbackWindowDays: z.number().optional(),
}).merge(customerIdOptional);

export const getConversionStatsSchema = z.object({
  conversionActionId: z.string().optional(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH',
    'ALL_TIME'
  ]).optional().default('LAST_30_DAYS'),
  segmentByConversionAction: z.boolean().optional().default(true),
}).merge(customerIdOptional);

function microsToNumber(micros: string | number | undefined): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  return Number(micros) / 1_000_000;
}

export async function listConversionActions(args: z.infer<typeof listConversionActionsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    let query = `
      SELECT 
        conversion_action.id,
        conversion_action.name,
        conversion_action.category,
        conversion_action.type,
        conversion_action.status,
        conversion_action.counting_type,
        conversion_action.attribution_model_settings.attribution_model,
        conversion_action.click_through_lookback_window_days,
        conversion_action.view_through_lookback_window_days,
        conversion_action.value_settings.default_value,
        conversion_action.value_settings.default_currency_code,
        conversion_action.value_settings.always_use_default_value,
        metrics.all_conversions,
        metrics.all_conversions_value
      FROM conversion_action
    `;
    
    if (!args.includeRemoved) {
      query += ` WHERE conversion_action.status != 'REMOVED'`;
    }
    
    const response = await client.query(query);
    
    return response.map(row => ({
      id: row.conversion_action?.id,
      name: row.conversion_action?.name,
      category: row.conversion_action?.category,
      type: row.conversion_action?.type,
      status: row.conversion_action?.status,
      countingType: row.conversion_action?.counting_type,
      attributionModel: row.conversion_action?.attribution_model_settings?.attribution_model,
      clickThroughLookbackWindowDays: row.conversion_action?.click_through_lookback_window_days,
      viewThroughLookbackWindowDays: row.conversion_action?.view_through_lookback_window_days,
      valueSettings: {
        defaultValue: row.conversion_action?.value_settings?.default_value,
        defaultCurrencyCode: row.conversion_action?.value_settings?.default_currency_code,
        alwaysUseDefaultValue: row.conversion_action?.value_settings?.always_use_default_value,
      },
      metrics: {
        allConversions: row.metrics?.all_conversions || 0,
        allConversionsValue: microsToNumber(row.metrics?.all_conversions_value) || 0,
      }
    }));
  } catch (error) {
    throw new Error(`Failed to list conversion actions: ${error.message}`);
  }
}

export async function createConversionAction(args: z.infer<typeof createConversionActionSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const resource = {
      name: args.name,
      category: args.category as resources.IConversionAction['category'],
      type: args.type as resources.IConversionAction['type'],
      status: args.status,
      counting_type: args.countingType,
      attribution_model_settings: {
        attribution_model: args.attributionModel,
      },
      click_through_lookback_window_days: args.clickThroughLookbackWindowDays,
      view_through_lookback_window_days: args.viewThroughLookbackWindowDays,
      value_settings: args.valueSettings
        ? {
            default_value: args.valueSettings.defaultValue,
            default_currency_code: args.valueSettings.defaultCurrencyCode,
            always_use_default_value: args.valueSettings.alwaysUseDefaultValue,
          }
        : undefined,
    };

    const response = await client.conversionActions.create([resource as resources.IConversionAction]);
    
    const result = response.results?.[0];
    const conversionActionId = result?.resource_name?.split('/').pop();
    
    return {
      success: true,
      conversionActionId,
      resourceName: result?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'create_conversion_action',
        action: 'Failed to create conversion action',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function updateConversionAction(args: z.infer<typeof updateConversionActionSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const cid = client.credentials.customer_id;
    const updateObject: resources.IConversionAction = {
      resource_name: `customers/${cid}/conversionActions/${args.conversionActionId}`,
    };
    
    if (args.name !== undefined) {
      updateObject.name = args.name;
    }
    
    if (args.status !== undefined) {
      updateObject.status = args.status;
    }
    
    if (args.countingType !== undefined) {
      updateObject.counting_type = args.countingType;
    }
    
    if (args.attributionModel !== undefined) {
      updateObject.attribution_model_settings = {
        attribution_model: args.attributionModel,
      };
    }
    
    if (args.clickThroughLookbackWindowDays !== undefined) {
      updateObject.click_through_lookback_window_days = args.clickThroughLookbackWindowDays;
    }
    
    if (args.viewThroughLookbackWindowDays !== undefined) {
      updateObject.view_through_lookback_window_days = args.viewThroughLookbackWindowDays;
    }
    
    if (args.valueSettings !== undefined) {
      updateObject.value_settings = {
        default_value: args.valueSettings.defaultValue,
        default_currency_code: args.valueSettings.defaultCurrencyCode,
        always_use_default_value: args.valueSettings.alwaysUseDefaultValue,
      };
    }
    
    const response = await client.conversionActions.update([updateObject]);
    
    return {
      success: true,
      resourceName: response.results?.[0]?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'update_conversion_action',
        action: 'Failed to update conversion action',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function getConversionStats(args: z.infer<typeof getConversionStatsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = args.dateRange === 'ALL_TIME' 
      ? '' 
      : ` DURING ${args.dateRange}`;
    
    let query = `
      SELECT 
        conversion_action.id,
        conversion_action.name,
        segments.conversion_action,
        segments.conversion_action_name,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.value_per_conversion,
        metrics.value_per_all_conversions,
        metrics.conversions_from_interactions_rate,
        metrics.view_through_conversions
      FROM conversion_action
    `;
    
    const conditions = [];
    
    if (args.conversionActionId) {
      conditions.push(`conversion_action.id = ${args.conversionActionId}`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += dateRangeClause;
    
    const response = await client.query(query);
    
    if (!args.segmentByConversionAction) {
      // Aggregate all conversion actions
      const totals = response.reduce((acc, row) => {
        acc.conversions += row.metrics?.conversions || 0;
        acc.conversionsValue += microsToNumber(row.metrics?.conversions_value) || 0;
        acc.allConversions += row.metrics?.all_conversions || 0;
        acc.allConversionsValue += microsToNumber(row.metrics?.all_conversions_value) || 0;
        acc.viewThroughConversions += row.metrics?.view_through_conversions || 0;
        return acc;
      }, {
        conversions: 0,
        conversionsValue: 0,
        allConversions: 0,
        allConversionsValue: 0,
        viewThroughConversions: 0,
      });
      
      return {
        dateRange: args.dateRange,
        totals,
      };
    }
    
    return {
      dateRange: args.dateRange,
      conversionActions: response.map(row => ({
        id: row.conversion_action?.id,
        name: row.conversion_action?.name || row.segments?.conversion_action_name,
        metrics: {
          conversions: row.metrics?.conversions || 0,
          conversionsValue: microsToNumber(row.metrics?.conversions_value) || 0,
          allConversions: row.metrics?.all_conversions || 0,
          allConversionsValue: microsToNumber(row.metrics?.all_conversions_value) || 0,
          valuePerConversion: microsToNumber(row.metrics?.value_per_conversion) || 0,
          valuePerAllConversions: microsToNumber(row.metrics?.value_per_all_conversions) || 0,
          conversionsFromInteractionsRate: row.metrics?.conversions_from_interactions_rate || 0,
          viewThroughConversions: row.metrics?.view_through_conversions || 0,
        }
      }))
    };
  } catch (error) {
    throw new Error(`Failed to get conversion stats: ${error.message}`);
  }
}

export const conversionTools: Tool[] = [
  {
    name: 'list_conversion_actions',
    description: 'List all conversion actions configured in the account',
    inputSchema: {
      type: 'object',
      properties: {
        includeRemoved: {
          type: 'boolean',
          description: 'Include removed conversion actions',
        },
      },
    },
  },
  {
    name: 'create_conversion_action',
    description: 'Create a new conversion action',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the conversion action',
        },
        category: {
          type: 'string',
          enum: ['PURCHASE', 'SIGNUP', 'LEAD', 'PAGE_VIEW', 'DOWNLOAD', 'OTHER'],
          description: 'Category of the conversion',
        },
        type: {
          type: 'string',
          enum: ['WEBPAGE', 'UPLOAD_CLICKS', 'AD_CALL', 'APP_DOWNLOAD'],
          description: 'Type of conversion tracking',
        },
        status: {
          type: 'string',
          enum: ['ENABLED', 'REMOVED', 'HIDDEN'],
          description: 'Status of the conversion action',
        },
        valueSettings: {
          type: 'object',
          properties: {
            defaultValue: {
              type: 'number',
              description: 'Default conversion value',
            },
            defaultCurrencyCode: {
              type: 'string',
              description: 'Currency code (e.g., USD, EUR)',
            },
            alwaysUseDefaultValue: {
              type: 'boolean',
              description: 'Always use the default value',
            },
          },
        },
        countingType: {
          type: 'string',
          enum: ['ONE_PER_CLICK', 'MANY_PER_CLICK'],
          description: 'How to count conversions',
        },
        attributionModel: {
          type: 'string',
          enum: ['EXTERNAL', 'GOOGLE_ADS_LAST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_FIRST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_LINEAR', 'GOOGLE_SEARCH_ATTRIBUTION_TIME_DECAY', 'GOOGLE_SEARCH_ATTRIBUTION_POSITION_BASED', 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN'],
          description: 'Attribution model to use',
        },
        clickThroughLookbackWindowDays: {
          type: 'number',
          description: 'Click-through conversion window in days (1-90)',
        },
        viewThroughLookbackWindowDays: {
          type: 'number',
          description: 'View-through conversion window in days (1-30)',
        },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'update_conversion_action',
    description: 'Update an existing conversion action',
    inputSchema: {
      type: 'object',
      properties: {
        conversionActionId: {
          type: 'string',
          description: 'ID of the conversion action to update',
        },
        name: {
          type: 'string',
          description: 'New name for the conversion action',
        },
        status: {
          type: 'string',
          enum: ['ENABLED', 'REMOVED', 'HIDDEN'],
          description: 'New status',
        },
        valueSettings: {
          type: 'object',
          properties: {
            defaultValue: {
              type: 'number',
              description: 'Default conversion value',
            },
            defaultCurrencyCode: {
              type: 'string',
              description: 'Currency code',
            },
            alwaysUseDefaultValue: {
              type: 'boolean',
              description: 'Always use the default value',
            },
          },
        },
        countingType: {
          type: 'string',
          enum: ['ONE_PER_CLICK', 'MANY_PER_CLICK'],
          description: 'How to count conversions',
        },
        attributionModel: {
          type: 'string',
          enum: ['EXTERNAL', 'GOOGLE_ADS_LAST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_FIRST_CLICK', 'GOOGLE_SEARCH_ATTRIBUTION_LINEAR', 'GOOGLE_SEARCH_ATTRIBUTION_TIME_DECAY', 'GOOGLE_SEARCH_ATTRIBUTION_POSITION_BASED', 'GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN'],
          description: 'Attribution model',
        },
        clickThroughLookbackWindowDays: {
          type: 'number',
          description: 'Click-through window in days',
        },
        viewThroughLookbackWindowDays: {
          type: 'number',
          description: 'View-through window in days',
        },
      },
      required: ['conversionActionId'],
    },
  },
  {
    name: 'get_conversion_stats',
    description: 'Get conversion statistics and performance',
    inputSchema: {
      type: 'object',
      properties: {
        conversionActionId: {
          type: 'string',
          description: 'Filter by specific conversion action ID (optional)',
        },
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'ALL_TIME'],
          description: 'Date range for statistics',
        },
        segmentByConversionAction: {
          type: 'boolean',
          description: 'Show breakdown by conversion action',
        },
      },
    },
  },
];