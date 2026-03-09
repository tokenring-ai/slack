import getRandomItem from "@tokenring-ai/utility/string/getRandomItem";
import workingMessages from "@tokenring-ai/utility/string/workingMessages";

const MAX = 3900;

export function splitIntoChunks(text: string | null): string[] {
  if (text === null) {
    return [`***${getRandomItem(workingMessages)}... ⏳***`];
  }

  // Split on header lines (lines starting with #) for more natural chunk boundaries.
  const sections = text.split(/(?=\n#)/);

  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    if (current.length + section.length > MAX) {
      if (current) chunks.push(current);
      current = section;
    } else {
      current += section;
    }
  }
  if (current) chunks.push(current);

  // Force-split any chunk that still exceeds MAX.
  return chunks.flatMap((chunk) => {
    const parts: string[] = [];
    while (chunk.length > MAX) {
      parts.push(chunk.substring(0, MAX));
      chunk = chunk.substring(MAX);
    }
    if (chunk) parts.push(chunk);
    return parts;
  });
}
