import { describe, expect, it } from "vitest";

import { parseHookInput } from "../../plugin/hooks/lib/read-hook-input.mjs";

const payload = {
  hook_event_name: "beforeShellExecution",
  command: "git push origin feature/example",
  cwd: "C:\\workspace\\repository",
};

const utf16Be = (value: string): Buffer => {
  const littleEndian = Buffer.from(value, "utf16le");
  const bigEndian = Buffer.alloc(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1];
    bigEndian[index + 1] = littleEndian[index];
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
};

describe("GitHub hook input reader", () => {
  it("parses ordinary UTF-8 JSON", () => {
    expect(parseHookInput(Buffer.from(JSON.stringify(payload), "utf8"))).toEqual(
      payload,
    );
  });

  it("accepts a UTF-8 BOM", () => {
    const input = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(payload), "utf8"),
    ]);

    expect(parseHookInput(input)).toEqual(payload);
  });

  it("trims surrounding whitespace", () => {
    const input = Buffer.from(` \r\n\t${JSON.stringify(payload)}\n `, "utf8");

    expect(parseHookInput(input)).toEqual(payload);
  });

  it("decodes UTF-16 little-endian JSON with a BOM", () => {
    const input = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(JSON.stringify(payload), "utf16le"),
    ]);

    expect(parseHookInput(input)).toEqual(payload);
  });

  it("decodes UTF-16 big-endian JSON with a BOM", () => {
    expect(parseHookInput(utf16Be(JSON.stringify(payload)))).toEqual(payload);
  });

  it("rejects empty and malformed input", () => {
    expect(() => parseHookInput(Buffer.alloc(0))).toThrow("Hook input is empty");
    expect(() => parseHookInput(Buffer.from("{", "utf8"))).toThrow(
      SyntaxError,
    );
  });
});
