declare module "*.css";

// Injected at build time by webpack's EnvironmentPlugin.
declare namespace NodeJS {
  interface ProcessEnv {
    NEO4J_URI?: string;
    NEO4J_USERNAME?: string;
    NEO4J_PASSWORD?: string;
    NEO4J_DATABASE?: string;
  }
}
