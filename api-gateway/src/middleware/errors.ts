import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";

import { logger } from "../logger.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
    response.status(400).json({ error: { code: "invalid_json", message: "Request body must contain valid JSON." } });
    return;
  }

  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    response.status(413).json({ error: { code: "payload_too_large", message: "Request body exceeds the size limit." } });
    return;
  }

  if (error instanceof multer.MulterError) {
    const fileTooLarge = error.code === "LIMIT_FILE_SIZE";
    response.status(fileTooLarge ? 413 : 400).json({
      error: {
        code: fileTooLarge ? "file_too_large" : "invalid_upload",
        message: fileTooLarge ? "The file exceeds the upload limit." : error.message,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "validation_error",
        message: "The request is invalid.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  logger.error({ err: error, method: request.method, path: request.path }, "unhandled request error");
  response.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred." } });
};
