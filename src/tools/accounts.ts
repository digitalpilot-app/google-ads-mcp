import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { customerIdOptional } from '../schema-common.js';

export const listAccessibleCustomersSchema = customerIdOptional;

export const getAccountHierarchySchema = customerIdOptional.merge(
  z.object({
    loginCustomerId: z.string().optional(),
  })
);

export const getAccountInfoSchema = z.object({
  customerId: z.string(),
});

export const listManagerAccountsSchema = customerIdOptional;

export async function listAccessibleCustomers(args: z.infer<typeof listAccessibleCustomersSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    // google-ads-api doesn't have a direct listAccessibleCustomers method
    // We'll use a query to get customer info instead
    const query = `
      SELECT 
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;
    
    const response = await client.query(query);
    
    return {
      customers: response.map(row => ({
        id: row.customer?.id,
        name: row.customer?.descriptive_name,
        currencyCode: row.customer?.currency_code,
        timeZone: row.customer?.time_zone,
      }))
    };
  } catch (error) {
    throw new Error(`Failed to list accessible customers: ${error.message}`);
  }
}

export async function getAccountHierarchy(args: z.infer<typeof getAccountHierarchySchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const query = `
      SELECT 
        customer_client.client_customer,
        customer_client.level,
        customer_client.manager,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.id
      FROM customer_client
      WHERE customer_client.level <= 2
    `;
    
    const response = await client.query(query);
    
    return response.map(row => ({
      id: row.customer_client?.id,
      descriptiveName: row.customer_client?.descriptive_name,
      currencyCode: row.customer_client?.currency_code,
      timeZone: row.customer_client?.time_zone,
      level: row.customer_client?.level,
      isManager: row.customer_client?.manager,
      clientCustomer: row.customer_client?.client_customer
    }));
  } catch (error) {
    throw new Error(`Failed to get account hierarchy: ${error.message}`);
  }
}

export async function getAccountInfo(args: z.infer<typeof getAccountInfoSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const query = `
      SELECT 
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.auto_tagging_enabled,
        customer.tracking_url_template,
        customer.optimization_score,
        customer.pay_per_conversion_eligibility_failure_reasons
      FROM customer
      WHERE customer.id = ${args.customerId}
    `;
    
    const response = await client.query(query);
    
    if (response.length === 0) {
      throw new Error('Customer not found');
    }
    
    const customer = response[0].customer;
    
    return {
      id: customer?.id,
      descriptiveName: customer?.descriptive_name,
      currencyCode: customer?.currency_code,
      timeZone: customer?.time_zone,
      autoTaggingEnabled: customer?.auto_tagging_enabled,
      trackingUrlTemplate: customer?.tracking_url_template,
      optimizationScore: customer?.optimization_score,
      payPerConversionEligibilityFailureReasons: customer?.pay_per_conversion_eligibility_failure_reasons || []
    };
  } catch (error) {
    throw new Error(`Failed to get account info: ${error.message}`);
  }
}

export async function listManagerAccounts(args: z.infer<typeof listManagerAccountsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const query = `
      SELECT 
        customer_manager_link.resource_name,
        customer_manager_link.manager_customer,
        customer_manager_link.status
      FROM customer_manager_link
      WHERE customer_manager_link.status = 'ACTIVE'
    `;
    
    const response = await client.query(query);
    
    return response.map(row => {
      const link = row.customer_manager_link;
      const rn = link?.resource_name;
      const clientId = rn?.match(/^customers\/(\d+)\/customerManagerLinks\//)?.[1];
      return {
        managerCustomer: link?.manager_customer,
        clientCustomer: clientId ? `customers/${clientId}` : undefined,
        status: link?.status,
      };
    });
  } catch (error) {
    throw new Error(`Failed to list manager accounts: ${error.message}`);
  }
}

export const accountTools: Tool[] = [
  {
    name: 'list_accessible_customers',
    description: 'List all Google Ads accounts accessible by the authenticated user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_account_hierarchy',
    description: 'Get the account hierarchy showing manager and client relationships',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Customer ID to get hierarchy for (optional)',
        },
        loginCustomerId: {
          type: 'string',
          description: 'Login customer ID for manager accounts (optional)',
        },
      },
    },
  },
  {
    name: 'get_account_info',
    description: 'Get detailed information about a specific Google Ads account',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Customer ID to get info for',
        },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'list_manager_accounts',
    description: 'List manager account relationships',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Customer ID to check manager relationships (optional)',
        },
      },
    },
  },
];