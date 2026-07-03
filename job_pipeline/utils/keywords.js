import { STACK_KEYWORDS } from '../config.js';

export function extractTags(description) {
  if (!description) return [];
  const text = description.toLowerCase();
  return STACK_KEYWORDS.filter((keyword) => text.includes(keyword.toLowerCase()));
}
