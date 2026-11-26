export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  OWNER_KEY_HASH: string;
  OWNER_EMAIL: string;
}

export type AppEnv = {
  Bindings: Env;
};
