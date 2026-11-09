import { BlobServiceClient } from "@azure/storage-blob";
import { createHash, randomUUID } from "node:crypto";

export class BlobStore {
  constructor(connectionString) {
    if (!connectionString) throw new Error("Falta configurar el almacenamiento de Azure.");
    this.container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient("content");
    this.salt = connectionString;
  }

  async read(name, initialValue) {
    const blob = this.container.getBlockBlobClient(`${name}.json`);
    try {
      const response = await blob.download();
      const chunks = [];
      for await (const chunk of response.readableStreamBody) chunks.push(chunk);
      return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")), version: response.etag };
    } catch (error) {
      if (error.statusCode === 404) return { value: initialValue, version: "initial" };
      throw error;
    }
  }

  async write(name, value, version) {
    const response = await this.container.getBlockBlobClient(`${name}.json`).uploadData(Buffer.from(JSON.stringify(value)), {
      conditions: version === "initial" ? { ifNoneMatch: "*" } : { ifMatch: version },
      blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8", blobCacheControl: "private, no-store" },
    });
    return { value, version: response.etag };
  }

  async rateLimit(kind, address, { limit = 1, interval = 60_000 } = {}) {
    const bucket = Math.floor(Date.now() / interval);
    const key = createHash("sha256").update(`${this.salt}:${kind}:${address}:${bucket}`).digest("hex");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.read(`limits/${key}`, { count: 0 });
      if (current.value.count >= limit) {
        const error = new Error("Request limit reached");
        error.statusCode = 429;
        throw error;
      }
      try {
        await this.write(`limits/${key}`, { count: current.value.count + 1 }, current.version);
        return;
      } catch (error) {
        if (![409, 412].includes(error.statusCode)) throw error;
      }
    }
    throw new Error("Could not reserve a request limit");
  }

  async submit(kind, value) {
    const id = kind === "newsletter"
      ? createHash("sha256").update(value.email).digest("hex")
      : `${new Date().toISOString()}-${randomUUID()}`;
    try {
      await this.container.getBlockBlobClient(`submissions/${kind}/${id}.json`).uploadData(Buffer.from(JSON.stringify(value)), {
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (kind === "newsletter" && [409, 412].includes(error.statusCode)) return;
      throw error;
    }
  }

  async submissions(kind, continuationToken) {
    const pages = this.container.listBlobsFlat({ prefix: `submissions/${kind}/` }).byPage({ maxPageSize: 100, continuationToken });
    const { value } = await pages.next();
    if (!value) return { items: [], continuationToken: null };
    const items = await Promise.all(value.segment.blobItems.map(async (blob) => {
      const data = await this.container.getBlockBlobClient(blob.name).downloadToBuffer();
      return JSON.parse(data.toString("utf8"));
    }));
    return { items, continuationToken: value.continuationToken || null };
  }
}
