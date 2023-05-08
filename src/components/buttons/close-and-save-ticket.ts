import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { generateAdminTicketMessage } from '@app/common/generate-admin-ticket-message';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import type { TextChannel } from 'discord.js';
import { ButtonInteraction, AttachmentBuilder, Colors } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';
import { setTimeout } from 'timers/promises';

const splitTranscript = (inputString: string): string[] => {
    const lines = inputString.split('\n');
    const result: string[] = [];
    let currentLine = '';

    // Loop through the lines
    for (const line of lines) {
        // If the line + current line is less than 8MB, add it to the current line
        // Otherwise, push the current line to the result and start a new line
        if (currentLine.length + line.length <= 8_000_000) {
            currentLine += `${line}\n`;
        } else {
            result.push(currentLine);
            currentLine = `${line}\n`;
        }
    }

    // Push the last line
    if (currentLine.length > 0) {
        result.push(currentLine);
    }

    return result;
};

@Discord()
export class CloseAndSaveTicketButton extends DiscordButton {
    service = 'close-and-save-ticket';

    @ButtonComponent({
        id: createRegex('close-and-save-ticket'),
    })
    async closeAndSaveTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) {
            if (interaction.customId.match(/^close-and-save-ticket \[(\d+)\] \[(update|reply)\]/)?.[2] === 'update') await interaction.deferUpdate();
            else await interaction.deferReply({ ephemeral: true });
        }

        // Get the ticket ID from the button's custom ID
        const ticketId = parseCustomId('close-and-save-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('channelId')
            .select('ticketAdminMessageId')
            .select('ticketNumber')
            .select('ownerId')
            .select('claimedById')
            .select('categoryId')
            .where('id', '=', ticketId)
            .executeTakeFirstOrThrow();

        // Get the ticket's category
        const category = await db
            .selectFrom('categories')
            .select('name')
            .select('transcriptionsChannelId')
            .select('ticketAdminChannelId')
            .where('id', '=', ticket.categoryId)
            .executeTakeFirstOrThrow();

        // Get the ticket channel
        const ticketChannel = ticket.channelId ? ((interaction.guild.channels.cache.get(ticket.channelId) ?? await interaction.guild.channels.fetch(ticket.channelId)) as TextChannel | null) : null;

        // If the channel doesn't exist, just send the ticket closed message
        if (!ticketChannel) {
            // Send the ticket closed message
            await interaction.editReply({
                content: `Ticket #${ticket.ticketNumber} has already been closed.`,
                components: [],
            });
            return;
        }

        // Check that ticket admin message has been created
        if (!ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

        // Get the ticket messages
        const messages = await ticketChannel.messages.fetch({ limit: 100 });

        // Create the transcript
        const transcript = messages
            .filter(message => {
                // Ignore messages from bots
                if (message.author.bot) return false;
                // Ignore messages with no content
                if (message.content.length === 0) return false;
                return true;
            })
            .map(message => `${message.author.tag}: ${message.content}`)
            .join('\n');

        // Create the files
        const files: AttachmentBuilder[] = [];

        // Add the transcript to the message
        if (transcript.length >= 1) {
            const transcriptChunks = splitTranscript(transcript);
            for (let index = 0; index < transcriptChunks.length; index++) {
                files.push(new AttachmentBuilder(Buffer.from(transcriptChunks[index]), {
                    name: `${category.name}-${ticket.ticketNumber}-transcript-part-${index}.txt`,
                }));
            }
        }

        // Send the message to the transcriptions channel
        await (interaction.guild.channels.cache.get(category.transcriptionsChannelId) as TextChannel).send({
            embeds: [{
                title: `Ticket #${ticket.ticketNumber} transcript`,
                description: `Ticket #${ticket.ticketNumber} has been closed and saved by <@${interaction.user.id}>`,
                color: Colors.Aqua,
                footer: {
                    text: `Ticket #${ticket.ticketNumber}`,
                },
            }],
            files,
        });

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
