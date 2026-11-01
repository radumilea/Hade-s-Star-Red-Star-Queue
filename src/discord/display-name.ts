import { GuildMember } from 'discord.js';

/** What an interaction's member looks like before discord.js resolves it. */
interface InteractionMemberLike {
  readonly member: GuildMember | { readonly nick?: string | null } | null;
  readonly user: { readonly displayName: string };
}

/**
 * The name to show for the person behind an interaction: their nickname in
 * the server when there is one, otherwise their global display name.
 */
export function displayNameOf(interaction: InteractionMemberLike): string {
  const { member } = interaction;
  if (member instanceof GuildMember) return member.displayName;
  if (member && typeof member.nick === 'string' && member.nick.length > 0) return member.nick;
  return interaction.user.displayName;
}
