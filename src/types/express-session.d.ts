import 'express-session';

declare module 'express-session' {
  interface SessionData {
    passport?: { user?: any };
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      accessToken?: string;
    }
    interface Request {
      containerInfo?: {
        id: string;
        name: string;
        image: string;
        ipAddress: string;
        serviceName?: string;
        labels: Record<string, string>;
        entrypoint?: string[] | null;
        args?: string[];
        cmd?: string[] | null;
      };
    }
  }
}

export {};
