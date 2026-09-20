import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import type { Document } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { getConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { getDocumentIngestionQueue } from "../lib/queues.js";
import { authenticate, type AuthenticatedRequest } from "../middleware/authenticate.js";
import { HttpError } from "../middleware/errors.js";
import { createRateLimiter, userKey } from "../middleware/rate-limit.js";

const allowedFiles = {
  ".pdf": new Set(["application/pdf"]),
  ".docx": new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  ".txt": new Set(["text/plain"]),
} as const;

type AllowedExtension = keyof typeof allowedFiles;

const upload = multer({
  storage: multer.diskStorage({
    destination(request, _file, callback) {
      const userId = (request as AuthenticatedRequest).userId;
      const destination = path.resolve(getConfig().UPLOAD_DIR, userId);
      void mkdir(destination, { recursive: true })
        .then(() => callback(null, destination))
        .catch((error: unknown) => callback(error as Error, destination));
    },
    filename(_request, file, callback) {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1, fields: 0 },
  fileFilter(_request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase() as AllowedExtension;
    const allowedMimeTypes = allowedFiles[extension];
    if (!allowedMimeTypes || !allowedMimeTypes.has(file.mimetype)) {
      callback(new HttpError(415, "unsupported_document", "Only PDF, DOCX, and plain-text files are supported."));
      return;
    }
    callback(null, true);
  },
});

const searchSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  topK: z.coerce.number().int().min(1).max(20).default(5),
  documentId: z.string().uuid().optional(),
}).strict();

const uploadLimiter = createRateLimiter({
  bucket: "document-upload",
  limit: getConfig().RATE_LIMIT_UPLOAD_MAX,
  windowMs: 60 * 60_000,
  key: userKey,
});

const retrievalLimiter = createRateLimiter({
  bucket: "document-search",
  limit: getConfig().RATE_LIMIT_CHAT_MAX,
  windowMs: 60_000,
  key: userKey,
});

function publicDocument(document: Document) {
  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: Number(document.sizeBytes),
    status: document.status,
    chunkCount: document.chunkCount,
    failureReason: document.failureReason,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    processedAt: document.processedAt,
  };
}

async function hasValidSignature(file: Express.Multer.File): Promise<boolean> {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === ".txt") {
    const contents = await readFile(file.path);
    new TextDecoder("utf-8", { fatal: true }).decode(contents);
    return !contents.includes(0);
  }
  const handle = await open(file.path, "r");
  try {
    const bytes = Buffer.alloc(Math.min(file.size, 8));
    await handle.read(bytes, 0, bytes.length, 0);
    if (extension === ".pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    if (extension === ".docx") return bytes.subarray(0, 2).toString("ascii") === "PK";
    return false;
  } finally {
    await handle.close();
  }
}

async function removeUploadedFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

export const documentsRouter = Router();

documentsRouter.post("/", authenticate, uploadLimiter, upload.single("file"), async (request, response) => {
  const userId = (request as AuthenticatedRequest).userId;
  const file = request.file;
  if (!file) throw new HttpError(400, "file_required", "Attach one document using the 'file' field.");

  if (!(await hasValidSignature(file))) {
    await removeUploadedFile(file.path);
    throw new HttpError(415, "invalid_document", "The uploaded file content does not match its file type.");
  }

  let document: Document | undefined;
  try {
    document = await prisma.document.create({
      data: {
        userId,
        filename: path.basename(file.originalname).slice(0, 255),
        storagePath: file.path,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
      },
    });
    await getDocumentIngestionQueue().add(
      "process-document",
      { documentId: document.id, userId },
      { jobId: `ingestion-${document.id}` },
    );
  } catch (error) {
    if (document) await prisma.document.delete({ where: { id: document.id } }).catch(() => undefined);
    await removeUploadedFile(file.path);
    throw error;
  }

  response.status(202).json({ document: publicDocument(document) });
});

documentsRouter.get("/", authenticate, async (request, response) => {
  const documents = await prisma.document.findMany({
    where: { userId: (request as AuthenticatedRequest).userId },
    orderBy: { createdAt: "desc" },
  });
  response.json({ documents: documents.map(publicDocument) });
});

documentsRouter.get("/:id", authenticate, async (request, response) => {
  const document = await prisma.document.findFirst({
    where: { id: z.string().uuid().parse(request.params.id), userId: (request as AuthenticatedRequest).userId },
  });
  if (!document) throw new HttpError(404, "document_not_found", "Document not found.");
  response.json({ document: publicDocument(document) });
});

documentsRouter.post("/search", authenticate, retrievalLimiter, async (request, response) => {
  const userId = (request as AuthenticatedRequest).userId;
  const input = searchSchema.parse(request.body);
  if (input.documentId) {
    const ownedDocument = await prisma.document.findFirst({
      where: { id: input.documentId, userId, status: "DONE" },
      select: { id: true },
    });
    if (!ownedDocument) throw new HttpError(404, "document_not_found", "A processed document with that ID was not found.");
  }

  const upstream = await fetch(`${getConfig().AGENT_SERVICE_URL}/agent/retrieval/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": getConfig().INTERNAL_API_TOKEN },
    body: JSON.stringify({ user_id: userId, query: input.query, top_k: input.topK, document_id: input.documentId }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await upstream.json().catch(() => undefined)) as unknown;
  if (!upstream.ok) {
    throw new HttpError(502, "retrieval_unavailable", "Document retrieval is currently unavailable.");
  }
  response.json(body);
});
