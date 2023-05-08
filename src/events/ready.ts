import { db } from '@app/common/database';
import { generateInputString } from '@app/common/generate-input-string';
import { DiscordEvent } from '@app/models/discord-event';
import type { Guild, TextChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Discord, On } from 'discordx';

@Discord()
export class ReadyEvent extends DiscordEvent {
    service = 'ready';

    async getGuilds() {
        // Get all the guilds that have this bot added
        const guilds = await db
            .selectFrom('guilds')
            .select('id')
            .execute();

        // Try and resolve all of the guild ids with discord
        // If the bot was removed from a guild while offline this will handle the cleanup
        const results = await Promise.allSettled(guilds.map(async ({ id }) => {
            // Get the guild
            const guild = this.client.guilds.cache.get(id);

            // If we can't get the guild's data skip it
            if (!guild) {
                // Mark it's status as "enabled=false" so it's skipped next startup
                await db
                    .updateTable('guilds')
                    .where('guilds.id', '=', id)
                    .set({
                        enabled: false,
                    })
                    .execute();
            }

            return guild;
        }));

        // Only return the guildIds that resolved
        return results.map(result => result.status === 'fulfilled' ? result.value : undefined).filter(Boolean);
    }

    async setupChannels(guilds: Guild[]) {
        const botUserId = this.client.user?.id;
        if (!botUserId) throw new Error('Bot is still starting');

        // Loop through all the guilds
        for (const guild of guilds) {
            // Get the panels for this guild
            const panels = await db
                .selectFrom('panels')
                .where('guildId', '=', guild.id)
                .select('id')
                .select('channelId')
                .select('categoryIds')
                .select('managerRoleIds')
                .execute();

            // Loop through all the panels for this guild
            for (const panel of panels) {
                // Make sure the channel for the panel exists
                const panelChannel = this.client.channels.cache.get(panel.channelId) ?? await this.client.channels.fetch(panel.channelId);

                // If we don't find the channel make one
                if (!panelChannel) {
                    this.logger.error('channel for panel not found', {
                        guildId: guild.id,
                        panelId: panel.id,
                        channelId: panel.channelId,
                    });

                    this.logger.info('Creating a new channel for the panel', {
                        guildId: guild.id,
                    });

                    // Create the channel
                    const channel = await guild.channels.create({
                        type: ChannelType.GuildText,
                        name: 'create-a-ticket',
                        parent: panel.channelId,
                    });

                    // Save the new channel ID
                    await db
                        .updateTable('panels')
                        .set({
                            channelId: channel.id,
                        })
                        .where('id', '=', panel.id)
                        .execute();
                }

                // Get all of the categories for this panel
                const categories = await db
                    .selectFrom('categories')
                    .select('id')
                    .select('ticketAdminChannelId')
                    .select('transcriptionsChannelId')
                    .where('categories.id', 'in', panel.categoryIds)
                    .execute();

                // Loop through all the categories in this panel
                for (const category of categories) {
                    // Make sure the ticket admin "tickets" channel exists
                    const ticketAdminChannel = this.client.channels.cache.get(category.ticketAdminChannelId) ?? await this.client.channels.fetch(category.ticketAdminChannelId);
                    if (!ticketAdminChannel) {
                        this.logger.error('Staff ticket admin "tickets" channel not found', {
                            guildId: guild.id,
                        });
                        this.logger.info('Creating ticket admin "tickets" channel', {
                            guildId: guild.id,
                        });
                        const channel = await guild.channels.create({
                            type: ChannelType.GuildText,
                            name: 'tickets',
                            permissionOverwrites: [
                                // Everyone can't see the channel
                                {
                                    id: guild.roles.everyone?.id ?? await guild.fetch().then(guild => guild.roles.everyone.id),
                                    deny: [
                                        PermissionFlagsBits.ViewChannel,
                                    ],
                                },
                                // The managers can see the channel
                                // By default they cannot delete messages
                                ...panel.managerRoleIds.map(id => ({
                                    id: id,
                                    allow: [
                                        PermissionFlagsBits.ReadMessageHistory,
                                        PermissionFlagsBits.ViewChannel,
                                    ],
                                })),
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

                        // Save the new channel ID
                        await db
                            .updateTable('categories')
                            .set({
                                ticketAdminChannelId: channel.id,
                            })
                            .where('id', '=', category.id)
                            .execute();
                    }

                    // Make sure the "transcriptions" channel exists
                    const transcriptionsChannel = this.client.channels.cache.get(category.transcriptionsChannelId) ?? await this.client.channels.fetch(category.transcriptionsChannelId);
                    if (!transcriptionsChannel) {
                        this.logger.error('"transcriptions" channel not found', {
                            guildId: guild.id,
                        });
                        this.logger.info('Creating "transcriptions" channel', {
                            guildId: guild.id,
                        });
                        const channel = await guild.channels.create({
                            type: ChannelType.GuildText,
                            name: 'transcriptions',
                            permissionOverwrites: [
                                // Everyone can't see the channel
                                {
                                    id: guild.roles.everyone?.id ?? await guild.fetch().then(guild => guild.roles.everyone.id),
                                    deny: [
                                        PermissionFlagsBits.ViewChannel,
                                    ],
                                },
                                // The managers can see the channel
                                // By default they cannot delete messages
                                ...panel.managerRoleIds.map(id => ({
                                    id: id,
                                    allow: [
                                        PermissionFlagsBits.ReadMessageHistory,
                                        PermissionFlagsBits.ViewChannel,
                                    ],
                                })),
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

                        // Save the new channel ID
                        await db
                            .updateTable('categories')
                            .set({
                                transcriptionsChannelId: channel.id,
                            })
                            .where('id', '=', category.id)
                            .execute();
                    }
                }
            }
        }
    }

    async setupCategories(guilds: Guild[]) {
        // Loop through all the guilds
        for (const guild of guilds) {
            // Get the panels for this guild
            const panels = await db
                .selectFrom('panels')
                .where('guildId', '=', guild.id)
                .select('id')
                .select('categoryIds')
                .execute();

            // Loop through all the panels for this guild
            for (const panel of panels) {
                // Get all of the categories for this panel
                const categories = await db
                    .selectFrom('categories')
                    .select('id')
                    .select('parentChannelId')
                    .where('categories.id', 'in', panel.categoryIds)
                    .execute();

                // Loop through all the categories in this panel
                for (const category of categories) {

                    // Make sure the tickets category exists
                    const ticketsCategory = this.client.channels.cache.get(category.parentChannelId) ?? await this.client.channels.fetch(category.parentChannelId);
                    if (!ticketsCategory) {
                        this.logger.error('Tickets category not found');
                        this.logger.info('Creating tickets category', {
                            guildId: guild.id,
                        });
                        const categoryChannel = await guild.channels.create({
                            name: 'Tickets',
                            type: ChannelType.GuildCategory,
                        });
                        // Update the category with it's new ID
                        await db
                            .updateTable('categories')
                            .set({
                                parentChannelId: categoryChannel.id,
                            })
                            .where('id', '=', category.id)
                            .execute();
                    }
                }
            }
        }
    }

    // TODO: Setup permissions
    async setupPermissions() {
        // // Get all the guilds that have this bot added
        // const guilds = await this.getGuilds();

        // // Loop through all the guilds that have this bot added
        // for (const guild of guilds) {
        // }
    }

    async setupCreateATicketMessage() {
        // Get all the guilds that have this bot added
        const guilds = await this.getGuilds();

        // Loop through all the guilds
        for (const guild of guilds) {
            // Get the panels for this guild
            const panels = await db
                .selectFrom('panels')
                .where('guildId', '=', guild.id)
                .select('id')
                .select('channelId')
                .execute();

            // Loop through all the panels for this guild
            for (const panel of panels) {
                // Get the channel
                const channel = (guild.channels.cache.get(panel.channelId) ?? await guild.channels.fetch(panel.channelId)) as TextChannel;

                // Get the messages
                const messages = await channel.messages.fetch();

                // Check if there is a message with the correct content
                const message = messages.find(m => m.content === 'Click the button to open a ticket');
                if (message) {
                    return;
                }

                // Send the message
                await channel.send({
                    content: 'Click the button to open a ticket',
                    components: [
                        new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(generateInputString('create-a-ticket', panel.id))
                                    .setLabel('Create a ticket')
                                    .setEmoji('🎫')
                                    .setStyle(ButtonStyle.Primary)
                            )
                    ],
                });
            }
        }
    }

    @On({
        event: 'ready',
    })
    async ready() {
        // Get all the guilds that have this bot added
        const guilds = await this.getGuilds();

        // Setup the categories
        await this.setupCategories(guilds);

        // Setup the channels
        await this.setupChannels(guilds);

        // Make sure permissions are correct
        await this.setupPermissions();

        // Make sure each panel's message exists
        await this.setupCreateATicketMessage();
    }
}