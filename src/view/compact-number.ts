export const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Grouped decimal output, deliberately distinct from compact notation. */
export const decimalNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format;
