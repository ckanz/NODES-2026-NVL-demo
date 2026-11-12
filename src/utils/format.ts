export const formatCount = (value: number) => value.toLocaleString("en-US");

// 0 to 1.
export const fractionOf = (inScene: number, total: number) =>
  total > 0 ? Math.min(1, inScene / total) : 0;

export const formatPercent = (fraction: number): string => {
  const percent = fraction * 100;
  if (percent === 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
};

// Shared by the live pane and the history cards, so both read the same.
export const formatGraphSummary = (
  nodes: number,
  relationships: number,
): string =>
  nodes === 0
    ? "Nothing selected yet"
    : `${formatCount(nodes)} nodes, ${formatCount(relationships)} relationships`;
