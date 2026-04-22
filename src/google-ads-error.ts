type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function getRequestId(error: unknown): string | undefined {
  const record = asRecord(error);
  const requestId = record?.request_id;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : undefined;
}

function getErrorList(error: unknown): UnknownRecord[] {
  const record = asRecord(error);
  const errors = record?.errors;
  return Array.isArray(errors) ? errors.map((item) => asRecord(item)).filter(Boolean) as UnknownRecord[] : [];
}

function flattenErrorCode(errorCode: unknown): string | undefined {
  const record = asRecord(errorCode);
  if (!record) return undefined;

  const firstSetCode = Object.entries(record).find(([, value]) => value !== undefined && value !== null && value !== 0);
  if (!firstSetCode) return undefined;

  const [family, value] = firstSetCode;
  return `${family}:${String(value)}`;
}

function flattenLocation(location: unknown): string | undefined {
  const record = asRecord(location);
  const fieldPathElements = record?.field_path_elements;
  if (!Array.isArray(fieldPathElements)) return undefined;

  const path = fieldPathElements
    .map((entry) => {
      const element = asRecord(entry);
      if (!element) return undefined;
      const fieldName = typeof element.field_name === 'string' ? element.field_name : undefined;
      const index = typeof element.index === 'number' ? `[${element.index}]` : '';
      if (!fieldName) return undefined;
      return `${fieldName}${index}`;
    })
    .filter((value): value is string => Boolean(value))
    .join('.');

  return path || undefined;
}

export function formatGoogleAdsError(error: unknown): string {
  const errorList = getErrorList(error);
  const requestId = getRequestId(error);

  if (errorList.length === 0) {
    const fallback = error instanceof Error ? error.message : String(error);
    return requestId ? `${fallback} (request_id: ${requestId})` : fallback;
  }

  const lines = errorList.map((item) => {
    const message = typeof item.message === 'string' ? item.message : 'Unknown Google Ads error';
    const code = flattenErrorCode(item.error_code);
    const location = flattenLocation(item.location);

    const segments = [
      code ? `[${code}]` : undefined,
      message,
      location ? `at ${location}` : undefined,
    ].filter((value): value is string => Boolean(value));

    return segments.join(' ');
  });

  const merged = lines.join(' | ');
  return requestId ? `${merged} (request_id: ${requestId})` : merged;
}

export function getGoogleAdsErrorDetails(error: unknown) {
  const errorList = getErrorList(error).map((item) => ({
    message: typeof item.message === 'string' ? item.message : undefined,
    code: flattenErrorCode(item.error_code),
    location: flattenLocation(item.location),
  }));

  return {
    requestId: getRequestId(error),
    errors: errorList,
  };
}

type MutateErrorContext = {
  operation: string;
  action: string;
  customerId?: string;
  request?: unknown;
};

export function throwGoogleAdsMutateError(context: MutateErrorContext, error: unknown): never {
  const formatted = formatGoogleAdsError(error);
  console.error(`[${context.operation}] Google Ads mutate failed`, {
    customerId: context.customerId,
    request: context.request,
    error: getGoogleAdsErrorDetails(error),
  });
  throw new Error(`${context.action}: ${formatted}`);
}
