import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createLiteralByteReplace } from '../src/literal-byte-replace.mjs';

const origin = 'https://private.example.test:8080';
const proxy = 'https://blofy.example.test/api/proxy/fixture-session';

async function transform(chunks, needle = origin, replacement = proxy) {
  const output = [];
  for await (const chunk of Readable.from(chunks).pipe(createLiteralByteReplace(needle, replacement))) {
    output.push(chunk);
  }
  return Buffer.concat(output);
}
function chunksOf(buffer, size) {
  return Array.from({ length: Math.ceil(buffer.length / size) }, (_, i) => buffer.subarray(i * size, (i + 1) * size));
}

const json = JSON.stringify([
  { name: 'أفلام عربية 🎬', icon: `${origin}/poster.jpg`, plot: 'مسلسل جديد', direct_source: `${origin}/source` },
  { name: '日本語 한국어', icon: `${origin}/cover.jpg`, note: `tail ${origin}` },
]);
const input = Buffer.from(json);
const expected = Buffer.from(json.split(origin).join(proxy));

test('preserves Arabic and emoji and replaces all origins at every two-chunk split', async () => {
  for (let split = 0; split <= input.length; split += 1) {
    assert.deepEqual(await transform([input.subarray(0, split), input.subarray(split)]), expected, `split ${split}`);
  }
});

test('preserves bytes at small, large and single-byte transport chunk sizes', async () => {
  for (const size of [1, 2, 3, 7, 16, 31, 32, 64, 128, input.length]) {
    const output = await transform(chunksOf(input, size));
    assert.deepEqual(output, expected, `chunk size ${size}`);
    assert.equal(output.includes(Buffer.from(origin)), false);
    assert.equal(JSON.parse(output.toString('utf8'))[0].name, 'أفلام عربية 🎬');
  }
});

test('does not emit a partial original host when the final match crosses the retained tail', async () => {
  const value = Buffer.from(`before ${origin}/p`);
  assert.equal((await transform([value])).toString(), `before ${proxy}/p`);
});

test('passes nonmatching bytes unchanged including incomplete multibyte data', async () => {
  const bytes = Buffer.from([0, 0xff, 0xd8, 0x82, 0xf0, 0x9f, 0x8e]);
  assert.deepEqual(await transform(chunksOf(bytes, 1)), bytes);
});

test('handles empty input, shorter input, and an incomplete origin at EOF', async () => {
  for (const value of ['', 'a', origin.slice(0, -1)]) {
    assert.equal((await transform(chunksOf(Buffer.from(value), 1))).toString(), value);
  }
});

test('matches literal non-overlapping replacement semantics including repeated prefixes', async () => {
  for (const [value, needle, replacement] of [
    ['aaaaaa', 'aaa', 'Z'], ['ababababab', 'abab', 'X'], ['abcabc', 'abc', ''],
    ['aXaXa', 'a', 'aaa'], ['end', 'd', '長い 🎬'], ['one.two.*', '.*', '$1\\'],
  ]) {
    for (const size of [1, 2, 3, 8]) {
      assert.equal((await transform(chunksOf(Buffer.from(value), size), needle, replacement)).toString(), value.split(needle).join(replacement));
    }
  }
});

test('separate requests do not share a retained tail', async () => {
  const partial = origin.slice(0, 9);
  assert.equal((await transform([Buffer.from(partial)])).toString(), partial);
  assert.equal((await transform([Buffer.from(origin.slice(9))])).toString(), origin.slice(9));
});

test('processes a generated 100000-item catalog incrementally without accumulating the response', async () => {
  const count = 100_000;
  const line = Buffer.from(`${JSON.stringify({ name: 'قناة عربية 🎬', icon: origin + '/image.jpg' })}\n`);
  const wantedLine = Buffer.from(line.toString().split(origin).join(proxy));
  async function* source() { for (let i = 0; i < count; i += 1) yield line; }
  let bytes = 0;
  for await (const output of Readable.from(source()).pipe(createLiteralByteReplace(origin, proxy))) bytes += output.length;
  assert.equal(bytes, count * wantedLine.length);
});

test('rejects an empty needle rather than looping indefinitely', () => {
  assert.throws(() => createLiteralByteReplace('', proxy), TypeError);
});
