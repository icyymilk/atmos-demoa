export type Identity = { kind: 'guest' | 'account'; ownerId: string; name: string; email?: string; userId?: string; expiresAt: number };
export type Session = Identity & { sessionId: string };
