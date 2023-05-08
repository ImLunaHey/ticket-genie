import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { generateAdminTicketMessage } from '@app/common/generate-admin-ticket-message';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import type { TextChannel } from 'discord.js';
import { ButtonInteraction } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';
import { setTimeout } from 'timers/promises';

@Discord()
export class CloseTicketButton extends DiscordButton {
    service = 'close-ticket';

    @ButtonComponent({
        id: createRegex('close-ticket'),
    })
    async closeTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket ID from the button's custom ID
        const ticketId = parseCustomId('close-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('ownerId')
            .select('channelId')
            .select('claimedById')
            .select('ticketAdminMessageId')
            .select('ticketNumber')
            .select('categoryId')
            .where('id', '=', ticketId)
            .executeTakeFirst();

        // If we have no record of the ticket in the database then it's somehow vanished
        // This should only really happen to tickets made before the rewrite to planetscale
        if (!ticket) {
            // Send the ticket missing message
            await interaction.editReply({
                content: `This ticket is missing. ID: ${ticketId}`,
                components: [],
            });
            return;
        }

        // Get the ticket's category
        const category = await db
            .selectFrom('categories')
            .select('name')
            .select('ticketAdminChannelId')
            .where('id', '=', ticket.categoryId)
            .executeTakeFirstOrThrow();

        this.logger.info('Closing ticket', {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            ticketId: ticket.id,
        });

        // Check that ticket admin message has been created
        if (!ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

        // Update the tickets channel
        const message = await (interaction.guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).messages.fetch(ticket.ticketAdminMessageId);
        await message?.edit(generateAdminTicketMessage({
            categoryName: category.name,
            createdById: ticket.ownerId,
            status: 'CLOSED',
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            claimedById: ticket.claimedById,
            note: `Ticket was closed by <@${interaction.user.id}>`
        }));

        // Get the ticket channel
        const ticketChannel = ticket.channelId ? (message.guild.channels.cache.get(ticket.channelId) ?? await message.guild.channels.fetch(ticket.channelId)) : null;

        // If the channel doesn't exist, just send the ticket closed message
        if (!ticketChannel) {
            // Send the ticket closed message
            await interaction.editReply({
                content: `Ticket #${ticket.ticketNumber} has been closed.`,
                components: [],
            });
            return;
        }

        // Send the ticket closed message
        await interaction.editReply({
            content: `Closing ticket #${ticket.ticketNumber} in 5 seconds...`,
            components: [],
        });

        // Wait 5 seconds
        await setTimeout(5_000);

        try {
            // Delete the channel
            await ticketChannel.delete();
        } catch { }

        // Send the ticket closed message
        if (interaction.channelId !== ticketChannel.id) {
            await interaction.editReply({
                content: `Ticket #${ticket.ticketNumber} has been closed.`,
                components: [],
            });
        }

        // Update the database
        await db
            .updateTable('tickets')
            .set({
                claimedById: null,
                state: 'CLOSED',
            })
            .where('id', '=', ticket.id)
            .execute();
    }
}
