import type { FamilyMember, Media, PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { TokenService } from './tokens.js';
import type { MediaQueue } from './queue.js';
import type { UrlSigner } from './signed-url.js';
import type { MediaStorage } from './storage.js';
import type { NotificationService } from '../services/notification.service.js';

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    tokens: TokenService;
    storage: MediaStorage;
    signer: UrlSigner;
    mediaQueue: MediaQueue;
    notifications: NotificationService;
    /** preHandler: verlangt gültiges Access-Token, setzt request.user */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: verlangt globalen Admin */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    membership: FamilyMember | null;
    /** Von Media-Routen geladen (requireFamilyPermission mit mediaFamilyResolver) */
    media: Media | null;
  }
}
