import { Transform } from 'node:stream';

/**
 * Replace a literal UTF-8 sequence without decoding individual transport chunks.
 * Keep at most needle.length - 1 bytes between chunks, including when a match crosses
 * that boundary. Unmatched bytes (Arabic, emoji, JSON escapes) stay byte-for-byte intact.
 */
export function createLiteralByteReplace(needleText, replacementText) {
  const needle = Buffer.from(needleText, 'utf8');
  const replacement = Buffer.from(replacementText, 'utf8');
  if (needle.length === 0) throw new TypeError('replacement needle must not be empty');
  let tail = Buffer.alloc(0);

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        const data = tail.length ? Buffer.concat([tail, input]) : input;
        let cursor = 0;
        let match = data.indexOf(needle, cursor);
        while (match !== -1) {
          if (match > cursor) this.push(data.subarray(cursor, match));
          if (replacement.length) this.push(replacement);
          cursor = match + needle.length;
          match = data.indexOf(needle, cursor);
        }
        // Never split a full match that ended beyond the ordinary retained-tail boundary.
        const safeEnd = Math.max(cursor, data.length - needle.length + 1);
        if (safeEnd > cursor) this.push(data.subarray(cursor, safeEnd));
        // Copy the short tail so it cannot retain an entire upstream response buffer.
        tail = Buffer.from(data.subarray(safeEnd));
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      if (tail.length) this.push(tail);
      tail = Buffer.alloc(0);
      callback();
    },
  });
}
