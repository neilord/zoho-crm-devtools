export interface FormattedTimestamp {
  date: string;
  time: string;
}

/**
 * Formats a Zoho timestamp (epoch millis, numeric string, or ISO string) into
 * locale date and time parts. Returns `null` for missing or unparseable values.
 */
export function formatTimestamp(
  value: string | number | undefined | null,
): FormattedTimestamp | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return { date: date.toLocaleDateString(), time: date.toLocaleTimeString() };
}
