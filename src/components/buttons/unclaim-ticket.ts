import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { generateInputString } from '@app/common/generate-input-string';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import type { TextChannel } from 'discord.js';
import { ButtonInteraction, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';

@Discord()
export class UnclaimTicketButton extends DiscordButton {
    service = 'unclaim-ticket';

    @ButtonComponent({
        id: createRegex('unclaim-ticket'),
    })
    async unclaimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferUpdate();

        // Get the ticket ID from the button's custom ID
        const ticketId = parseCustomId('unclaim-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('channelId')
            .select('ticketAdminMessageId')
            .select('ticketNumber')
            .select('categoryId')
            .where('id', '=', ticketId)
            .executeTakeFirstOrThrow();

        // Get the ticket's category
        const category = await db
            .selectFrom('categories')
            .select('name')
            .select('ticketAdminChannelId')
            .where('id', '=', ticket.categoryId)
            .executeTakeFirstOrThrow();

        // Get the ticket channel
        const channel = ticket.channelId ? ((interaction.guild.channels.cache.get(ticket.channelId) ?? await interaction.guild.channels.fetch(ticket.channelId)) as TextChannel | null) : null;

        // Check if the ticket's channel still exists
        if (!channel) {
            // Reply with an error message
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Ticket not found')
                        .setDescription(`Ticket #${ticket.ticketNumber} could not be found, it may have been closed.`)
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

        // Check that ticket admin message has been created
        if (!ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

        // Update the channel permissions
        // TODO: Fix this
        await channel.permissionOverwrites.cache.find(override => override.id === interaction.user.id)?.delete();

        // Update the database
        await db
            .updateTable('tickets')
            .set({
                claimedById: null,
            })
            .where('id', '=', ticket.id)
            .execute();

        // Update the admin ticket
        const message = await (interaction.guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).messages.fetch(ticket.ticketAdminMessageId);
        if (message) {
            await message.edit({
                embeds: [{
                    title: 'Unclaimed ticket',
                    description: `Ticket #${ticket.ticketNumber} is open and unclaimed`,
                    color: Colors.Aqua,
                    footer: {
                        text: `Ticket #${ticket.ticketNumber}`,
                    },
                    timestamp: new Date().toISOString(),
                }],
                components: [
                    new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(generateInputString('close-and-save-ticket', ticket.id, { action: 'reply' }))
                                .setLabel('Close & save')
                                .setEmoji('💾')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(generateInputString('close-ticket', ticket.id))
                                .setLabel('Close ticket')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(generateInputString('claim-ticket', ticket.id))
                                .setLabel('Claim ticket')
                                .setEmoji('🙋‍♀️')
                                .setStyle(ButtonStyle.Success),
                        )
                ],
            });
        }

        // Delete the old claim message
        const claimMessage = await channel.messages.fetch({ limit: 100 }).then(messages => messages.find(message => message.embeds[0]?.title === 'Ticket claimed'));
        if (claimMessage) await claimMessage.delete();

        // Let the user know the ticket has been unclaimed
        await channel.send({
            content: '@here',
            embeds: [
                new EmbedBuilder()
                    .setTitle('Ticket unclaimed')
                    .setDescription('This ticket has been unclaimed, another member of staff should be along shortly to help you.')
                    .setColor(Colors.Aqua)
                    .setTimestamp(new Date())
            ],
        });

        // Send the ticket unclaimed message
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Ticket unclaimed')
                    .setDescription(`Ticket #${ticket.ticketNumber} has been unclaimed`)
                    .setColor(Colors.Aqua)
                    .setFooter({
                        text: `Ticket #${ticket.ticketNumber}`,
                    }),
            ],
            components: [],
        });
    }

}