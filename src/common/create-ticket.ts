import { client } from '@app/client';
import { db } from '@app/common/database';
import { generateAdminTicketMessage } from '@app/common/generate-admin-ticket-message';
import { generateInputString } from '@app/common/generate-input-string';
import { globalLogger } from '@app/logger';
import { randomUUID } from 'crypto';
import type { Guild, User, TextChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setTimeout } from 'timers/promises';

const getNextTicketNumber = async (guildId: string): Promise<number> => {
    return db.transaction().execute(async trx => {
        // Increment the ticket number by 1
        await trx
            .updateTable('guilds')
            .set((eb) => ({
                ticketNumber: eb.bxp('ticketNumber', '+', 1)
            }))
            .where('id', '=', guildId)
            .executeTakeFirstOrThrow();

        // Get the updated ticket number
        const category = await trx
            .selectFrom('guilds')
            .select('ticketNumber')
            .where('id', '=', guildId)
            .executeTakeFirstOrThrow();

        return category.ticketNumber;
    });
};

export const createTicket = async (guild: Guild, user: User, categoryId: string): Promise<TextChannel> => {
    const botUserId = client.user?.id;
    if (!botUserId) throw new Error('Bot is still starting');

    // Get the next ticket number
    const ticketNumber = await getNextTicketNumber(guild.id);

    // Get the category
    const category = await db
        .selectFrom('categories')
        .select('name')
        .select('parentChannelId')
        .select('panelId')
        .select('ticketAdminChannelId')
        .select('nsfw')
        .select('emoji')
        .select('ticketMessage')
        .where('id', '=', categoryId)
        .executeTakeFirstOrThrow();

    globalLogger.info('Creating ticket channel', {
        userId: user.id,
        guildId: guild.id,
        ticketNumber,
    });

    // Create the channel
    const channel = await guild.channels.create({
        name: `${category.name}-${ticketNumber}`,
        type: ChannelType.GuildText,
        parent: category?.parentChannelId,
        nsfw: category?.nsfw ?? false,
        permissionOverwrites: [
            // Everyone can't see the channel
            {
                id: guild.roles.everyone?.id ?? await guild.fetch().then(guild => guild.roles.everyone.id),
                deny: [
                    PermissionFlagsBits.ViewChannel,
                ],
            },
            // The user can see the channel
            // The user can send messages in the channel
            {
                id: user.id,
                allow: [
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ViewChannel,
                ],
            },
            // Ticket Genie can delete the channel
            // Ticket Genie can send embed messages in the channel
            // Ticket Genie can change permissions in the channel
            {
                id: botUserId,
                allow: [
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ViewChannel,
                ],
            }
        ],
    });

    // Save the ticket to the database
    const ticketId = randomUUID();
    await db
        .insertInto('tickets')
        .values({
            id: ticketId,
            guildId: guild.id,
            ownerId: user.id,
            categoryId,
            ticketNumber,
            state: 'OPEN',
            panelId: category.panelId,
            channelId: channel.id,
        })
        .execute();

    globalLogger.info('Creating ticket admin message', {
        userId: user.id,
        guildId: guild.id,
        ticketNumber,
        ticketId,
    });

    // Create a message for the staff to see
    const ticketAdminMessage = await (guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).send(generateAdminTicketMessage({
        categoryName: category.name,
        createdById: user.id,
        status: 'OPEN',
        ticketId,
        ticketNumber,
    }));

    // Update the "ticket admin message ID" on the ticket
    await db
        .updateTable('tickets')
        .set({
            ticketAdminMessageId: ticketAdminMessage.id,
        })
        .where('id', '=', ticketId)
        .execute();

    // Post the message for the user to see
    await channel.send({
        embeds: [{
            title: `${category.emoji ?? (category.nsfw ? '🔞' : '🎟️')} ${category.name}`,
            description: category.ticketMessage,
            color: Colors.Aqua,
            footer: {
                text: `Ticket #${ticketNumber}`,
            },
        }],
        components: [
            new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(generateInputString('close-ticket', ticketId))
                        .setLabel('Close ticket')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(generateInputString('staff-tools', ticketId))
                        .setLabel('Staff tools')
                        .setEmoji('🛠️')
                        .setStyle(ButtonStyle.Secondary)
                )
        ],
    });

    // Tag the user so they know to read the instructions
    const message = await channel.send({
        content: `<@${user.id}> please read the message above, someone will be with you shortly.`,
    });

    // Wait 30s then delete the reminder
    void setTimeout(30_000).then(async () => {
        try {
            // Delete the message
            await message.delete();
        } catch { }
    });

    // Return the newly created ticket channel
    return channel;
};
