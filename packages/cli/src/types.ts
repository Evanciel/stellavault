// Shared CLI types for Commander.js command handlers

/** Commander.js Command instance (minimal shape used by our handlers) */
export interface CliCommand {
  parent?: {
    opts?: () => { json?: boolean; vault?: string; [key: string]: unknown };
  };
}

/** Standard command handler signature: (options, command) */
export type CommandHandler<TOpts = Record<string, never>> = (opts: TOpts, cmd: CliCommand) => Promise<void>;
