import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const supportedAssets = [
  {
    relativePath: "plugin/assets/logo.png",
    width: 1024,
    height: 1024,
  },
  {
    relativePath: "docs/assets/hero.png",
    width: 1024,
    height: 512,
  },
];

const pngSignature = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(...buffers) {
  let checksum = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      checksum =
        crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function hexBytes(buffer) {
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function parsePng(buffer, expected) {
  if (buffer.length < pngSignature.length) {
    throw new Error("file is shorter than the PNG signature");
  }

  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(
      `PNG signature mismatch (found ${hexBytes(buffer.subarray(0, 8))})`,
    );
  }

  let offset = pngSignature.length;
  let header = null;
  let idatChunks = 0;
  let compressedImageData = [];
  let sawIend = false;
  let chunkCount = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) {
      throw new Error("truncated PNG chunk header");
    }

    const dataLength = buffer.readUInt32BE(offset);
    offset += 4;
    const chunkType = buffer.subarray(offset, offset + 4);
    offset += 4;
    const dataEnd = offset + dataLength;
    const crcEnd = dataEnd + 4;

    if (dataEnd > buffer.length || crcEnd > buffer.length) {
      throw new Error(
        `chunk ${chunkType.toString("ascii")} exceeds the file boundary`,
      );
    }

    const chunkData = buffer.subarray(offset, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(chunkType, chunkData);
    if (expectedCrc !== actualCrc) {
      throw new Error(
        `CRC mismatch in ${chunkType.toString("ascii")} chunk`,
      );
    }

    const chunkName = chunkType.toString("ascii");
    if (chunkName === "IHDR") {
      if (chunkCount !== 0 || header !== null || dataLength !== 13) {
        throw new Error("IHDR must be the first and only 13-byte header chunk");
      }

      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compressionMethod: chunkData[10],
        filterMethod: chunkData[11],
        interlaceMethod: chunkData[12],
      };
    } else if (chunkName === "IDAT") {
      if (header === null) {
        throw new Error("IDAT appears before IHDR");
      }
      idatChunks += 1;
      compressedImageData.push(chunkData);
    } else if (chunkName === "IEND") {
      if (dataLength !== 0 || header === null || idatChunks === 0) {
        throw new Error("IEND is missing required PNG image data");
      }
      sawIend = true;
      offset = crcEnd;
      break;
    }

    chunkCount += 1;
    offset = crcEnd;
  }

  if (!sawIend || offset !== buffer.length) {
    throw new Error("PNG must end immediately after IEND");
  }

  if (header.width !== expected.width || header.height !== expected.height) {
    throw new Error(
      `dimensions are ${header.width}x${header.height}; expected ${expected.width}x${expected.height}`,
    );
  }

  if (header.bitDepth !== 8 || header.colorType !== 2) {
    throw new Error(
      `expected 8-bit RGB data without alpha; found bit depth ${header.bitDepth}, color type ${header.colorType}`,
    );
  }

  if (
    header.compressionMethod !== 0 ||
    header.filterMethod !== 0 ||
    header.interlaceMethod !== 0
  ) {
    throw new Error("unsupported PNG compression, filter, or interlace method");
  }

  let decodedImageData;
  try {
    decodedImageData = inflateSync(Buffer.concat(compressedImageData));
  } catch (error) {
    throw new Error(`IDAT data cannot be decompressed: ${error.message}`);
  }

  const bytesPerRow = header.width * 3;
  const expectedDecodedLength = header.height * (bytesPerRow + 1);
  if (decodedImageData.length !== expectedDecodedLength) {
    throw new Error(
      `decoded scanline data is ${decodedImageData.length} bytes; expected ${expectedDecodedLength}`,
    );
  }

  return header;
}

function validateAsset(asset) {
  const absolutePath = path.join(repositoryRoot, asset.relativePath);
  if (path.extname(asset.relativePath).toLowerCase() !== ".png") {
    throw new Error("supported asset must use the .png extension");
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (error) {
    throw new Error(`cannot read file: ${error.message}`);
  }

  const header = parsePng(buffer, asset);
  return `${asset.relativePath}: PNG ${header.width}x${header.height}, 8-bit RGB`;
}

let failures = 0;
for (const asset of supportedAssets) {
  try {
    console.log(`PASS ${validateAsset(asset)}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${asset.relativePath}: ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`${failures} supported asset(s) failed validation.`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${supportedAssets.length} supported asset(s).`);
}
