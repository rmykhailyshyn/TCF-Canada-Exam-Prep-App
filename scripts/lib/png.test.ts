import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { solidColorPng } from "./png";

// solidColorPng is a pure, dependency-free encoder (no spec — dev-seed helper). These tests pin the
// PNG container structure and the pixel payload so the reading UI's image path keeps getting a real,
// decodable image.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Walk the chunk stream after the 8-byte signature: [len:4][type:4][data:len][crc:4].
function readChunks(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

describe("solidColorPng", () => {
  it("starts with the PNG signature", () => {
    const png = solidColorPng(4, 3, [10, 20, 30]);
    expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  });

  it("emits IHDR, IDAT, IEND chunks in order", () => {
    const chunks = readChunks(solidColorPng(2, 2, [0, 0, 0]));
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks[chunks.length - 1].data.length).toBe(0); // IEND carries no data
  });

  it("encodes width, height, and a truecolour (type 2) 8-bit header", () => {
    const [ihdr] = readChunks(solidColorPng(7, 5, [1, 2, 3]));
    expect(ihdr.data.readUInt32BE(0)).toBe(7); // width
    expect(ihdr.data.readUInt32BE(4)).toBe(5); // height
    expect(ihdr.data.readUInt8(8)).toBe(8); // bit depth
    expect(ihdr.data.readUInt8(9)).toBe(2); // colour type: truecolour RGB
  });

  it("fills every pixel with the requested RGB, each row led by a 0 filter byte", () => {
    const width = 3;
    const height = 2;
    const rgb: [number, number, number] = [255, 128, 64];
    const idat = readChunks(solidColorPng(width, height, rgb)).find(
      (c) => c.type === "IDAT",
    );
    expect(idat).toBeDefined();

    const raw = inflateSync(idat!.data);
    const rowBytes = width * 3;
    expect(raw.length).toBe((rowBytes + 1) * height);

    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (rowBytes + 1);
      expect(raw[rowStart]).toBe(0); // filter byte
      for (let x = 0; x < width; x += 1) {
        const px = rowStart + 1 + x * 3;
        expect([raw[px], raw[px + 1], raw[px + 2]]).toEqual(rgb);
      }
    }
  });

  it("encodes a 1x1 image", () => {
    const png = solidColorPng(1, 1, [9, 9, 9]);
    const idat = readChunks(png).find((c) => c.type === "IDAT");
    const raw = inflateSync(idat!.data);
    expect(raw.length).toBe(4); // 1 filter byte + 3 RGB bytes
    expect([raw[1], raw[2], raw[3]]).toEqual([9, 9, 9]);
  });
});
