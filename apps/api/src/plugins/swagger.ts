import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

async function swaggerPlugin(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Familienalbum API',
        description: 'Privates, selbst gehostetes Familienalbum – REST-API.',
        version: '0.1.0',
      },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Anmeldung, Token-Refresh, Abmeldung' },
        { name: 'me', description: 'Eigenes Profil' },
        { name: 'families', description: 'Familien und Mitglieder' },
        { name: 'invites', description: 'Einladungen' },
        { name: 'media', description: 'Upload, Timeline, Dateien' },
        { name: 'comments', description: 'Kommentare' },
        { name: 'push', description: 'Push-Token und Aktivität (Polling)' },
        { name: 'admin', description: 'Globale Administration' },
        { name: 'system', description: 'Health etc.' },
      ],
    },
    transform: jsonSchemaTransform,
    // Zod-Schemas mit `.meta({ id })` landen als benannte Komponenten (schönere Dart-Modelle).
    transformObject: jsonSchemaTransformObject,
    // Der Server-Eintrag oben enthält bereits das Präfix; Pfade daher ohne /api/v1 ausgeben.
    stripBasePath: true,
  });

  if (app.config.nodeEnv !== 'test') {
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }
}

export default fp(swaggerPlugin, { name: 'swagger' });
