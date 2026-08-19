import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16_LE_BOM = [0xff, 0xfe];
const UTF16_BE_BOM = [0xfe, 0xff];

const hasPrefix = (bytes, prefix) =>
  bytes.length >= prefix.length &&
  prefix.every((value, index) => bytes[index] === value);

const decode = (bytes) => {
  if (hasPrefix(bytes, UTF8_BOM)) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
  }

  if (hasPrefix(bytes, UTF16_LE_BOM)) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  }

  if (hasPrefix(bytes, UTF16_BE_BOM)) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export const parseHookInput = (input) => {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError("Hook input must be a byte array.");
  }

  const json = decode(input).trim();
  if (json.length === 0) {
    throw new SyntaxError("Hook input is empty.");
  }

  return JSON.parse(json);
};

export const readHookInput = (fd = 0, maxBytes) => {
  const input = readFileSync(fd);
  if (maxBytes !== undefined && input.byteLength > maxBytes) {
    throw new RangeError("Hook input exceeds the configured byte limit.");
  }
  return parseHookInput(input);
};
