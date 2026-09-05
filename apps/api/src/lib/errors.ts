import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

/**
 * Anwendungsfehler, der als RFC 7807 Problem-JSON ausgegeben wird.
 * `title` ist der generische HTTP-Titel, `detail` ein für Benutzer verständlicher (deutscher) Text,
 * `code` ein stabiler, maschinenlesbarer Bezeichner für die App.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string,
    public readonly code: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (detail: string, code = 'BAD_REQUEST') => new AppError(400, 'Bad Request', detail, code),
  unauthorized: (detail = 'Anmeldung erforderlich.', code = 'UNAUTHORIZED') =>
    new AppError(401, 'Unauthorized', detail, code),
  forbidden: (detail = 'Keine Berechtigung für diese Aktion.', code = 'FORBIDDEN') =>
    new AppError(403, 'Forbidden', detail, code),
  notFound: (detail = 'Nicht gefunden.', code = 'NOT_FOUND') => new AppError(404, 'Not Found', detail, code),
  conflict: (detail: string, code = 'CONFLICT') => new AppError(409, 'Conflict', detail, code),
  gone: (detail: string, code = 'GONE') => new AppError(410, 'Gone', detail, code),
};

export interface ProblemJson {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

const PROBLEM_TYPE_BASE = 'https://familienalbum.local/problems/';

function sendProblem(reply: FastifyReply, request: FastifyRequest, problem: ProblemJson) {
  return reply
    .status(problem.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .send({ ...problem, instance: request.url });
}

const HTTP_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, request, {
      type: `${PROBLEM_TYPE_BASE}not-found`,
      title: 'Not Found',
      status: 404,
      detail: `Route ${request.method} ${request.url} existiert nicht.`,
      code: 'ROUTE_NOT_FOUND',
    }),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return sendProblem(reply, request, {
        type: `${PROBLEM_TYPE_BASE}${error.code.toLowerCase().replace(/_/g, '-')}`,
        title: error.title,
        status: error.status,
        detail: error.detail,
        code: error.code,
        ...error.extra,
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(reply, request, {
        type: `${PROBLEM_TYPE_BASE}validation`,
        title: 'Bad Request',
        status: 400,
        detail: 'Die Anfrage enthält ungültige Daten.',
        code: 'VALIDATION_ERROR',
        errors: error.validation.map((v) => ({
          path: `${error.validationContext ?? ''}${v.instancePath}`.replace(/^\//, ''),
          message: v.message ?? 'ungültig',
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response serialization failed');
      return sendProblem(reply, request, {
        type: `${PROBLEM_TYPE_BASE}internal`,
        title: 'Internal Server Error',
        status: 500,
        detail: 'Die Antwort konnte nicht erzeugt werden.',
        code: 'RESPONSE_SERIALIZATION',
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return sendProblem(reply, request, {
          type: `${PROBLEM_TYPE_BASE}conflict`,
          title: 'Conflict',
          status: 409,
          detail: 'Ein Eintrag mit diesen Werten existiert bereits.',
          code: 'UNIQUE_VIOLATION',
        });
      }
      if (error.code === 'P2025') {
        return sendProblem(reply, request, {
          type: `${PROBLEM_TYPE_BASE}not-found`,
          title: 'Not Found',
          status: 404,
          detail: 'Der Eintrag wurde nicht gefunden.',
          code: 'NOT_FOUND',
        });
      }
    }

    // Fastify-eigene Fehler (429 Rate-Limit, 415, 413, JSON-Parse 400, ...)
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return sendProblem(reply, request, {
        type: `${PROBLEM_TYPE_BASE}http-${statusCode}`,
        title: HTTP_TITLES[statusCode] ?? 'Error',
        status: statusCode,
        detail: (error as Error).message,
        code: (error as { code?: string }).code ?? `HTTP_${statusCode}`,
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(reply, request, {
      type: `${PROBLEM_TYPE_BASE}internal`,
      title: 'Internal Server Error',
      status: 500,
      detail: 'Ein unerwarteter Fehler ist aufgetreten.',
      code: 'INTERNAL',
    });
  });
}
