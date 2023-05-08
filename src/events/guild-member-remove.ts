import { db } from '@app/common/database';
import { generateAdminTicketMessage } from '@app/common/generate-admin-ticket-message';
import { DiscordEvent } from '@app/models/discord-event';
import type { GuildMember, TextChannel } from 'discord.js';
import { Discord, On } from 'discordx';

@Discord()
export class GuildMemberRemoveEvent extends DiscordEvent {
    service = 'guild-member-remove';

    @On({
        event: 'guildMemberRemove'
    })
    async guildMemberRemove([guildMember]: [GuildMember]) {
        // Get all of the tickets for this guild member that're still open
        const tickets = await db
            .selectFrom('tickets')
            .select('id')
            .select('channelId')
            .select('categoryId')
            .select('ticketNumber')
            .select('ticketAdminMessageId')
            .where('tickets.ownerId', '=', guildMember.id)
            .where('guildId', '=', guildMember.guild.id)
            .where('state', '=', 'OPEN')
            .execute();

        // Close each ticket
        for (const ticket of tickets) {
            this.logger.info('Closing ticket', {
                userId: guildMember.user.id,
                guildId: guildMember.guild.id,
                ticketId: ticket.id,
            });

            const category = await db
                .selectFrom('categories')
                .select('name')
                .select('ticketAdminChannelId')
                .where('id', '=', ticket.categoryId)
                .executeTakeFirstOrThrow();

            // Get the ticket channel
            const ticketChannel = ticket.channelId ? (guildMember.guild.channels.cache.get(ticket.channelId) ?? await guildMember.guild.channels.fetch(ticket.channelId)) : null;

            // If the channel still exists try to delete it
            if (ticketChannel) {
                try {
                    await ticketChannel.delete();
                } catch { }
            }

            // Check that ticket admin message has been created
            if (!category.ticketAdminChannelId || !ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

            // Update the ticket admin message
            const message = await (guildMember.guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).messages.fetch(ticket.ticketAdminMessageId);
            if (message) {
                await message.edit(generateAdminTicketMessage({
                    categoryName: category.name,
                    createdById: guildMember.id,
                    status: 'CLOSED',
                    note: 'Ticket was closed as the member has left the server.',
                    ticketId: ticket.id,
                    ticketNumber: ticket.ticketNumber,
                }));
            }

            // Update the database
            await db
                .updateTable('tickets')
                .set({
                    state: 'CLOSED',
                    claimedById: undefined,
                })
                .execute();
        }
    }
}
