import { matchesToken } from '../db/client.js';

function findBucket(text, signals) {
  if (!text) return null;
  for (const signal of signals) {
    if (matchesToken(text, signal.signal)) return signal.bucket;
  }
  return null;
}

// resolveLocationBucket checks the structured `location` field first (short,
// well-formed strings — safe to match against abbreviations like state codes).
// The `description` fallback skips 2-char signals (state abbreviations, "UK")
// since those collide with common English words in free-form prose (e.g. "in",
// "or", "me", "hi", "pa" would false-positive on nearly every description).
export function resolveLocationBucket(location, description, enabledSignals) {
  const locationBucket = findBucket(location, enabledSignals);
  if (locationBucket) return locationBucket;

  const descriptionSignals = enabledSignals.filter((s) => s.signal.length > 2);
  const descriptionBucket = findBucket(description, descriptionSignals);
  if (descriptionBucket) return descriptionBucket;

  return 'unknown';
}
