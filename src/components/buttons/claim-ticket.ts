import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { generateAdminTicketMessage } from '@app/common/generate-admin-ticket-message';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import type { TextChannel } from 'discord.js';
import { ButtonInteraction, EmbedBuilder, Colors } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';

@Discord()
export class ClaimTicketButton extends DiscordButton {
    service = 'claim-ticket';

    @ButtonComponent({
        id: createRegex('claim-ticket'),
    })
    async claimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket ID from the button's custom ID
        const ticketId = parseCustomId('claim-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        this.logger.info('Claiming ticket', {
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            ticketId,
        });

        // Get the staff member's claimed ticket count
        const claimedTickets = await db
            .selectFrom('tickets')
            .select(db.fn.count<number>('id').as('count'))
            .where('claimedById', '=', interaction.user.id)
            .executeTakeFirst()
            .then(row => row?.count ?? 0);

        // Check if the staff member has too many claimed tickets
        if (claimedTickets >= 10) {
            await interaction.editReply({
                content: 'You can only claim 10 tickets at a time on the free plan',
                components: [],
            });
            return;
        }

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

        // Get the ticket channel
        const ticketChannel = ticket.channelId ? ((interaction.guild.channels.cache.get(ticket.channelId) ?? await interaction.guild.channels.fetch(ticket.channelId)) as TextChannel | null) : null;

        // Check that ticket admin message has been created
        if (!ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

        // Check if the ticket's channel still exists
        if (!ticketChannel) {
            // Reply with an error message
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Ticket not found')
                        .setDescription(`Ticket #${ticket.ticketNumber} could not be found, it may have already been closed.`)
                        .setColor(Colors.Red)
                        .setTimestamp(new Date())
                        .setFooter({
                            text: `Ticket #${ticket.ticketNumber}`,
                        }),
                ],
                components: [],
            });
            return;
        }

        // Update the database
        await db
            .updateTable('tickets')
            .set({
                claimedById: interaction.user.id,
            })
            .where('id', '=', ticket.id)
            .execute();

        // Update the admin ticket
        const message = await (interaction.guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).messages.fetch(ticket.ticketAdminMessageId);
        await message?.edit(generateAdminTicketMessage({
            categoryName: category.name,
            createdById: ticket.ownerId,
            status: 'PENDING',
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            claimedById: interaction.user.id,
        }));

        this.logger.info('Claiming ticket', {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            ticketId: ticket.id,
        });

        // Update the channel permissions
        await ticketChannel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        });

        // Delete the unclaimed ticket message
        const unclaimedTicketMessage = await ticketChannel.messages.fetch({ limit: 100 }).then(messages => messages.find(message => message.embeds[0]?.title === 'Ticket unclaimed'));
        if (unclaimedTicketMessage) await unclaimedTicketMessage.delete();

        // Let the user know the ticket has been claimed
        await ticketChannel.send({
            content: '@here',
            embeds: [
                new EmbedBuilder()
                    .setTitle('Ticket claimed')
                    .setDescription(`This ticket has been claimed by <@${interaction.user.id}>, please give them a moment to respond.`)
                    .setColor(Colors.Aqua)
                    .setTimestamp(new Date())
            ],
        });

        // Send the ticket claimed message
        await interaction.editReply({
            content: `Ticket #${ticket.ticketNumber} has been claimed, you can now view and reply to it in <#${ticketChannel.id}>`,
            components: [],
        });
    }
}
