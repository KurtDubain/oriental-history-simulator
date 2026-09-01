/**
 * Serialize trusted build data for an HTML `application/json` script.
 *
 * Escaping `<` prevents a profile label from terminating the script element;
 * the two Unicode separators are escaped for parsers that still treat them as
 * JavaScript line terminators while processing HTML script text.
 */
export function serializeApplicationJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('application/json payload cannot be undefined');
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
