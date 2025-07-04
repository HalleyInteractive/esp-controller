/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { crc32 } from "../utils/crc32";
import { NVSSettings, NvsType } from "./nvs-settings";

const NVS_BLOCK_SIZE = NVSSettings.BLOCK_SIZE;

export class NvsEntry implements NvsKeyValue {
  namespaceIndex: number;
  type: NvsType;
  key: string;
  data: string | number;
  chunkIndex: number;

  headerNamespace: Uint8Array;
  headerType: Uint8Array;
  headerSpan: Uint8Array;
  headerChunkIndex: Uint8Array;
  headerCRC32: Uint8Array;
  headerKey: Uint8Array;
  headerData: Uint8Array;
  headerDataSize: Uint8Array;
  headerDataCRC32: Uint8Array;

  headerBuffer: Uint8Array;
  dataBuffer: Uint8Array;

  entriesNeeded = 0;

  constructor(entry: NvsKeyValue) {
    this.namespaceIndex = entry.namespaceIndex;
    this.type = entry.type;
    this.data = entry.data;
    this.chunkIndex = 0xff; // Default for non-blob types

    // Validate key length before modification
    if (entry.key.length > 15) {
      throw Error(
        `NVS max key length is 15, received '${entry.key}' of length ${entry.key.length}`,
      );
    }
    this.key = entry.key + "\0";

    // Initialize buffers
    this.headerBuffer = new Uint8Array(NVS_BLOCK_SIZE);
    this.headerNamespace = new Uint8Array(this.headerBuffer.buffer, 0, 1);
    this.headerType = new Uint8Array(this.headerBuffer.buffer, 1, 1);
    this.headerSpan = new Uint8Array(this.headerBuffer.buffer, 2, 1);
    this.headerChunkIndex = new Uint8Array(this.headerBuffer.buffer, 3, 1);
    this.headerCRC32 = new Uint8Array(this.headerBuffer.buffer, 4, 4);
    this.headerKey = new Uint8Array(this.headerBuffer.buffer, 8, 16);
    this.headerData = new Uint8Array(this.headerBuffer.buffer, 24, 8);
    this.headerDataSize = new Uint8Array(this.headerBuffer.buffer, 24, 4);
    this.headerDataCRC32 = new Uint8Array(this.headerBuffer.buffer, 28, 4);
    this.dataBuffer = new Uint8Array(0);

    // Process and populate data and header
    this.setEntryData();
    this.setEntryHeader();
    this.setEntryHeaderCRC();
  }

  private setEntryHeader() {
    const encoder = new TextEncoder();
    this.headerNamespace.set([this.namespaceIndex]);
    this.headerType.set([this.type]);
    this.headerSpan.set([this.entriesNeeded]);
    this.headerChunkIndex.set([this.chunkIndex]);
    this.headerKey.set(encoder.encode(this.key));
  }

  private setEntryData() {
    if (this.type === NvsType.STR) {
      this.setStringEntry();
    } else if (typeof this.data === "number") {
      this.setPrimitiveEntry();
    } else {
      throw new Error("Unsupported data type for NVS entry.");
    }
  }

  // In src/nvs/nvs-entry.ts

  private setStringEntry() {
    if (typeof this.data === "string") {
      // FIX: Fill the entire 8-byte data field with 0xff for correct padding.
      this.headerData.fill(0xff);

      const valueWithTerminator = this.data + "\0";
      const encoder = new TextEncoder();
      const data = encoder.encode(valueWithTerminator);

      if (data.length > 4000) {
        throw new Error("String values are limited to 4000 bytes.");
      }

      this.entriesNeeded = 1 + Math.ceil(data.length / NVSSettings.BLOCK_SIZE);
      this.dataBuffer = new Uint8Array(
        (this.entriesNeeded - 1) * NVSSettings.BLOCK_SIZE,
      ).fill(0xff);
      this.dataBuffer.set(data);

      const dataSizeBuffer = new ArrayBuffer(2);
      const dataSizeView = new DataView(dataSizeBuffer);
      // The true parameter indicates little-endian byte order.
      dataSizeView.setUint16(0, data.length, true);

      // Set the size in the first 2 bytes of the 8-byte headerData field.
      this.headerData.set(new Uint8Array(dataSizeBuffer), 0);
      // Set the data CRC in the last 4 bytes of the 8-byte headerData field.
      this.headerDataCRC32.set(crc32(data));
    }
  }

  private setPrimitiveEntry() {
    if (typeof this.data === "number") {
      this.entriesNeeded = 1;
      // First, fill the entire 8-byte data field with 0xff for correct padding
      this.headerData.fill(0xff);

      const dataView = new DataView(
        this.headerData.buffer,
        this.headerData.byteOffset,
        8,
      );

      switch (this.type) {
        case NvsType.U8:
          dataView.setUint8(0, this.data);
          break;
        case NvsType.I8:
          dataView.setInt8(0, this.data);
          break;
        case NvsType.U16:
          dataView.setUint16(0, this.data, true);
          break;
        case NvsType.I16:
          dataView.setInt16(0, this.data, true);
          break;
        case NvsType.U32:
          dataView.setUint32(0, this.data, true);
          break;
        case NvsType.I32:
          dataView.setInt32(0, this.data, true);
          break;
        case NvsType.U64:
          dataView.setBigUint64(0, BigInt(this.data), true);
          break;
        case NvsType.I64:
          dataView.setBigInt64(0, BigInt(this.data), true);
          break;
        default:
          throw new Error(`Unsupported primitive type: ${this.type}`);
      }
    }
  }

  private setEntryHeaderCRC() {
    const crcData = new Uint8Array(28);
    crcData.set(this.headerBuffer.slice(0, 4), 0);
    crcData.set(this.headerBuffer.slice(8, 32), 4);
    this.headerCRC32.set(crc32(crcData));
  }
}
