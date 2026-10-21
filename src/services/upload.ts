/** Image upload: COS signed PUT via the editor's three-step token flow. */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { XhhHttp } from "../client/http.js";
import { XhhError } from "../client/errors.js";

export interface UploadedImage {
  url: string;
  width: number;
  height: number;
}

interface UploadInfo {
  keys: string[];
  region: string;
  bucket: string;
  host: string;
}

interface UploadToken {
  credentials: { tmpSecretId: string; tmpSecretKey: string; sessionToken: string };
  startTime: number;
  expiredTime: number;
}

/** Read width/height from a PNG header; other formats fall back to a safe default. */
export function imageSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length > 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 600, height: 400 };
}

function mimeOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

/**
 * Tencent COS request signature (v5, sha1). Only the `host` header is signed.
 * See the public COS signature documentation for the algorithm.
 */
export function cosAuthorization(options: {
  secretId: string;
  secretKey: string;
  method: string;
  pathname: string;
  host: string;
  signTime: string;
}): string {
  const signKey = createHmac("sha1", options.secretKey).update(options.signTime).digest("hex");
  const httpString = `${options.method.toLowerCase()}\n${options.pathname}\n\nhost=${options.host}\n`;
  const stringToSign = `sha1\n${options.signTime}\n${sha1Hex(httpString)}\n`;
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");
  return (
    `q-sign-algorithm=sha1&q-ak=${options.secretId}` +
    `&q-sign-time=${options.signTime}&q-key-time=${options.signTime}` +
    `&q-header-list=host&q-url-param-list=&q-signature=${signature}`
  );
}

/** Upload one local image and return its public URL. */
export async function uploadImage(http: XhhHttp, filePath: string): Promise<UploadedImage> {
  const buffer = readFileSync(filePath);
  const fileName = basename(filePath);
  const mime = mimeOf(fileName);
  const { width, height } = imageSize(buffer);

  const info = await http.postForm<{ result?: UploadInfo }>("/bbs/app/api/qcloud/cos/upload/info/v2", {
    webVersion: "3.0",
    form: {
      file_infos: JSON.stringify([{ name: fileName, mimetype: mime, fsize: buffer.length, width, height }]),
      scope: "bbs",
      need_cache: 0,
    },
  });
  const uploadInfo = info.result;
  if (!uploadInfo?.keys?.[0]) throw new XhhError("upstream", "上传信息接口没有返回 key");

  const key = uploadInfo.keys[0];
  const token = await http.postForm<{ result?: UploadToken }>("/bbs/app/api/qcloud/cos/upload/token/v2", {
    webVersion: "3.0",
    form: {
      bucket: uploadInfo.bucket,
      keys: JSON.stringify(uploadInfo.keys),
      mimetypes: JSON.stringify([mime]),
      is_multipart_upload: 0,
    },
  });
  const credentials = token.result?.credentials;
  if (!credentials?.tmpSecretId) throw new XhhError("upstream", "上传凭证接口没有返回临时密钥");

  const host = `${uploadInfo.bucket}.cos.${uploadInfo.region}.myqcloud.com`;
  const signTime = `${token.result?.startTime ?? Math.floor(Date.now() / 1000)};${
    token.result?.expiredTime ?? Math.floor(Date.now() / 1000) + 600
  }`;
  const authorization = cosAuthorization({
    secretId: credentials.tmpSecretId,
    secretKey: credentials.tmpSecretKey,
    method: "PUT",
    pathname: key,
    host,
    signTime,
  });

  const response = await fetch(`https://${host}${key}`, {
    method: "PUT",
    headers: {
      authorization,
      "content-type": mime,
      "x-cos-security-token": credentials.sessionToken,
    },
    body: new Uint8Array(buffer),
  });
  if (!response.ok) {
    throw new XhhError("upstream", `图片上传失败：HTTP ${response.status}`);
  }

  await http.postForm("/bbs/app/api/qcloud/cos/upload/callback/v2", {
    webVersion: "3.0",
    form: { keys: JSON.stringify(uploadInfo.keys) },
  });

  return { url: `https://${uploadInfo.host}${key}`, width, height };
}
