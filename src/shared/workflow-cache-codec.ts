import {
  isPackedWorkflowCache,
  isWorkflowCache,
  type PackedWorkflowCache,
  reportWorkflowCacheIssue,
  WORKFLOW_CACHE_LIMIT,
  WORKFLOW_PACKED_LIMIT,
  type WorkflowCache,
} from './workflow-cache-protocol';

/** Compress before messaging as well as storage; CRM source never leaves this device. */
export async function packWorkflowCache(value: WorkflowCache): Promise<PackedWorkflowCache> {
  if (!isWorkflowCache(value)) {
    reportWorkflowCacheIssue(value);
    throw new Error('Invalid or oversized workflow snapshot');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = byteStream(bytes).pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < compressed.length; i += 8192)
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  const data = btoa(binary);
  if (data.length > WORKFLOW_PACKED_LIMIT) {
    reportWorkflowCacheIssue({ encoding: 'gzip-base64', savedAt: value.savedAt, data });
    throw new Error('Compressed workflow cache exceeds budget');
  }
  if (import.meta.env.MODE === 'development')
    console.debug('Zoho CRM DevTools: workflow cache sizes', {
      rawBytes: bytes.length,
      packedCharacters: data.length,
    });
  return { encoding: 'gzip-base64', savedAt: value.savedAt, data };
}

export async function unpackWorkflowCache(value: unknown): Promise<WorkflowCache | null> {
  if (isWorkflowCache(value)) return value;
  if (!isPackedWorkflowCache(value)) {
    if (value != null) reportWorkflowCacheIssue(value);
    return null;
  }
  const bytes = Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0));
  const reader = byteStream(bytes).pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let size = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.length;
    if (size > WORKFLOW_CACHE_LIMIT) {
      await reader.cancel();
      throw new Error('Decompressed workflow cache exceeds budget');
    }
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  const decoded: unknown = JSON.parse(chunks.join('') + decoder.decode());
  if (!isWorkflowCache(decoded)) {
    reportWorkflowCacheIssue(decoded);
    throw new Error('Invalid workflow cache payload');
  }
  return decoded;
}

function byteStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
