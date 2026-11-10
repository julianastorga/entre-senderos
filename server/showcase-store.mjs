import { DEFAULT_POSTS } from "../sample-posts.mjs";

export async function readShowcase(store) {
  const current = await store.read("showcase", null);
  if (current.value !== null) return current;
  const publishedAt = new Date().toISOString();
  const value = { version: 1, texts: DEFAULT_POSTS.map((text) => ({ ...text, publishedAt })) };
  try { return await store.write("showcase", value, "initial"); }
  catch (error) {
    if (![409, 412].includes(error.statusCode)) throw error;
    return store.read("showcase", null);
  }
}
