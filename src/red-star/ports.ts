import type { MessageCreateOptions, MessageEditOptions } from 'discord.js';

/**
 * Minimal structural views of the discord.js objects the matchmaking service
 * touches. Real discord.js Message / channel / interaction objects satisfy
 * them (test/ports.types.test.ts proves it); tests use small fakes.
 */

export interface QueueMessage {
  readonly id: string;
  readonly url: string;
  /** When Discord created the message; lets a fresh process spot cards older than itself. */
  readonly createdTimestamp: number;
  edit(options: MessageEditOptions): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface QueueChannel {
  readonly id: string;
  send(options: MessageCreateOptions): Promise<QueueMessage>;
}

export interface ButtonPort {
  readonly message: QueueMessage;
  deferUpdate(): Promise<unknown>;
}
