export type PdfTextItemLike = {
  str?: string;
  transform?: Array<number | undefined>;
  hasEOL?: boolean;
};

export type PdfTextContentLike = {
  items?: unknown[];
};

type ReconstructedTextItem = {
  str: string;
  x: number;
  y: number;
  index: number;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getItemCoordinates(item: PdfTextItemLike, index: number): ReconstructedTextItem | null {
  const str = compact(String(item.str ?? ""));
  if (!str) return null;

  const transform = Array.isArray(item.transform) ? item.transform : null;
  const x = toNumber(transform?.[4]) ?? 0;
  const y = toNumber(transform?.[5]) ?? 0;

  return { str, x, y, index };
}

export function reconstructPdfTextFromTextContent(textContent: PdfTextContentLike, lineTolerance = 3.5) {
  const items = (textContent.items ?? [])
    .map((item, index) => {
      if (typeof item !== "object" || item === null || !("str" in item)) return null;
      return getItemCoordinates(item as PdfTextItemLike, index);
    })
    .filter((item): item is ReconstructedTextItem => Boolean(item))
    .sort((left, right) => right.y - left.y || left.x - right.x || left.index - right.index);

  if (items.length === 0) return "";

  const lines: string[] = [];
  let currentLine: ReconstructedTextItem[] = [];
  let currentLineY: number | null = null;

  const flushLine = () => {
    if (currentLine.length === 0) return;
    const line = currentLine
      .slice()
      .sort((left, right) => left.x - right.x || left.index - right.index)
      .map((item) => item.str)
      .join(" ");
    const compacted = compact(line);
    if (compacted) lines.push(compacted);
    currentLine = [];
    currentLineY = null;
  };

  for (const item of items) {
    if (currentLineY === null || Math.abs(item.y - currentLineY) <= lineTolerance) {
      currentLine.push(item);
      currentLineY = currentLineY === null ? item.y : (currentLineY + item.y) / 2;
    } else {
      flushLine();
      currentLine.push(item);
      currentLineY = item.y;
    }
  }

  flushLine();

  return lines.join("\n");
}
