import '@total-typescript/ts-reset';
import { client } from '@app/client';
import { globalLogger } from '@app/logger';
import { ButtonComponent, Discord, On, SelectMenuComponent } from 'discordx';
import type { TextChannel, User, GuildMemberRoleManager, Role, Guild, GuildMember } from 'discord.js';
import { Collection } from 'discord.js';
import {
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    StringSelectMenuInteraction,
    PermissionFlagsBits,
    Colors,
    AttachmentBuilder,
    EmbedBuilder,
    DiscordAPIError
} from 'discord.js';
import { db } from '@app/common/database';
import { randomUUID } from 'crypto';
import { setTimeout } from 'timers/promises';
import { sql } from 'kysely';

type MyObject<T = Record<string, unknown>> = {
    phrase: string;
    uuid: string;
    json_args: T;
}

const resolveRoles = async (guild: Guild, roles: GuildMemberRoleManager | string[] | null | undefined) => {
    if (!roles) return new Collection<string, Role>();
    if (Array.isArray(roles)) return guild.roles.fetch();
    return roles.cache;
};

const createRegex = (phrase: string): RegExp => new RegExp(`(${phrase})\\s+(?<uuid>[a-fA-F0-9-]+)\\s+(?<json_args>{.*}|undefined)`);

const parse = <T>(phrase: string, input: string): MyObject<T> => {
    const match = input.match(createRegex(phrase));
    if (!match) throw new Error(`This is used in the wrong button, looking in "${input}" for "${phrase}".`);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { uuid, json_args } = match.groups!;
    const parsedJson = json_args === 'undefined' ? undefined as T : JSON.parse(json_args) as T;
    return {
        phrase,
        uuid,
        json_args: parsedJson,
    };
};

const generateInputString = <T>(phrase: string, uuid: string, jsonArgs?: T): string => {
    const jsonArgsString = JSON.stringify(jsonArgs);
    return `${phrase} ${uuid} ${jsonArgsString}`;
};

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
export class Feature {
    private client = client;
    private logger = globalLogger.child({
        service: 'tickets',
    });

    constructor() {
        this.logger.info('Initialised');
    }

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

    async getTicketChannel(userId: string, guild: Guild, ticketId: string, categoryName: string, ticketNumber: number) {
        // Get the ticket channel
        const channelName = `${categoryName}-${ticketNumber}`.toLowerCase();
        this.logger.info('Looking for channel', {
            userId,
            guildId: guild.id,
            ticketId,
            channelName
        });

        // Check if the channel is cached
        const cachedChannel = guild.channels.cache.find(channel => channel.name === channelName) as TextChannel;

        // Fetch the channels if we can't find it
        if (!cachedChannel) await guild.channels.fetch();

        // Check if we now have the channel
        // If we don't then it doesn't exist or we can't see it
        return cachedChannel || guild.channels.cache.find(channel => channel.name === channelName) as TextChannel;
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

    generateAdminTicketMessage({
        categoryName,
        status,
        createdById,
        claimedById,
        ticketId,
        ticketNumber,
        note,
    }: {
        categoryName: string;
        status: 'OPEN' | 'CLOSED' | 'PENDING';
        createdById: string;
        claimedById?: string;
        ticketId: string;
        ticketNumber: number;
        note?: string;
    }) {
        const color = {
            OPEN: Colors.Green,
            CLOSED: Colors.Grey,
            PENDING: Colors.Yellow,
        }[status];

        const embed = new EmbedBuilder({
            title: categoryName,
            color: color ?? Colors.White,
            fields: [{
                name: 'ID',
                value: ticketId,
                inline: true,
            }, {
                name: 'Created by',
                value: `<@${createdById}>`,
                inline: true,
            }, {
                name: claimedById ? 'Claimed by' : '\u200b',
                value: claimedById ? `<@${claimedById}>` : '\u200b',
                inline: true,
            }, {
                name: 'Status',
                value: `${status.toLowerCase()[0].toUpperCase()}${status.toLowerCase().substring(1, status.length)}`,
                inline: true,
            }],
            description: note,
            footer: {
                text: `Ticket #${ticketNumber}`,
            },
        });

        const components = {
            OPEN: new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(generateInputString('close-and-save-ticket', ticketId, { action: 'reply' }))
                        .setLabel('Close and save transcript')
                        .setEmoji('💾')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(generateInputString('close-ticket', ticketId))
                        .setLabel('Close ticket')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(generateInputString('claim-ticket', ticketId))
                        .setLabel('Claim ticket')
                        .setEmoji('🙋‍♀️')
                        .setStyle(ButtonStyle.Success),
                ),
            PENDING: new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(generateInputString('close-and-save-ticket', ticketId, { action: 'reply' }))
                        .setLabel('Close and save transcript')
                        .setEmoji('💾')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(generateInputString('close-ticket', ticketId))
                        .setLabel('Close ticket')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(generateInputString('unclaim-ticket', ticketId))
                        .setDisabled(true)
                        .setLabel('Ticket claimed')
                        .setEmoji('🙋‍♀️')
                        .setStyle(ButtonStyle.Success),
                ),
            CLOSED: new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(generateInputString('open-ticket', ticketId))
                        .setLabel('Open ticket')
                        .setEmoji('🔓')
                        .setStyle(ButtonStyle.Secondary),
                ),
        };
        return {
            embeds: [embed],
            components: [components[status]],
        };
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

    @On({
        event: 'guildCreate'
    })
    async guildCreate([guild]: [Guild]) {
        this.logger.info('Added to server', {
            guildId: guild.id,
        });

        try {
            // Message owner
            const owner = await this.client.users.fetch('784365843810222080');
            if (!owner.dmChannel) await owner.createDM();
            await owner.dmChannel?.send({
                embeds: [{
                    title: 'Added to server',
                    fields: [{
                        name: 'Server ID',
                        value: String(guild.id),
                    }]
                }]
            });
        } catch (error: unknown) {
            this.logger.error('Failed to message owner', { error });
        }

        try {
            // If we don't have any of the channels cached fetch them
            if (guild.channels.cache.size === 0) await guild.channels.fetch();

            // Sending setup message
            const channel = [...guild.channels.cache.values()].filter(channel => channel.type === ChannelType.GuildText)[0] as TextChannel;
            await channel.send({
                content: 'Hi, please message <@784365843810222080> to help me get setup.',
            });
        } catch (error: unknown) {
            this.logger.error('Failed to send setup message', { error });
        }

        try {
            // Add basic info about guild to database
            await db
                .insertInto('guilds')
                .ignore()
                .values({
                    id: guild.id,
                    ticketNumber: 0,
                })
                .execute();
        } catch (error: unknown) {
            this.logger.error('Failed to add basic guild info to database', { error });
        }
    }

    @On({
        event: 'guildDelete'
    })
    async guildDelete([guild]: [Guild]) {
        this.logger.info('Removed from server', {
            guildId: String(guild.id),
        });

        // Message owner
        const owner = await this.client.users.fetch('784365843810222080');
        if (!owner.dmChannel) await owner.createDM();
        await owner.dmChannel?.send({
            embeds: [{
                title: 'Removed from server',
                fields: [{
                    name: 'Server ID',
                    value: String(guild.id),
                }]
            }]
        });
    }

    @On({
        event: 'guildMemberRemove'
    })
    async guildMemberRemove([guildMember]: [GuildMember]) {
        // Get all of the tickets for this guild member that're still open
        const tickets = await db
            .selectFrom('tickets')
            .select('id')
            .select('categoryId')
            .select('ticketNumber')
            .select('ticketAdminMessageId')
            .where('tickets.ownerId', '=', guildMember.id)
            .where('guildId', '=', guildMember.guild.id)
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
            const channel = await this.getTicketChannel(guildMember.user.id, guildMember.guild, ticket.id, category.name, ticket.ticketNumber);

            // If the channel still exists try to delete it
            if (channel) {
                try {
                    await channel.delete();
                } catch { }
            }

            // Check that ticket admin message has been created
            if (!category.ticketAdminChannelId || !ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

            // Update the ticket admin message
            const message = await (guildMember.guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).messages.fetch(ticket.ticketAdminMessageId);
            if (message) {
                await message.edit(this.generateAdminTicketMessage({
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

    @ButtonComponent({
        id: createRegex('create-a-ticket'),
    })
    async createATicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;
        const member = interaction.member;
        if (!member) return;

        // Show the bot is thinking
        await interaction.deferReply({ ephemeral: true });

        // Get the panelId from the button's customId
        const panelId = parse('create-a-ticket', interaction.customId).uuid;

        // Get the user's roles
        const roleIds = await resolveRoles(interaction.guild, interaction.member?.roles).then(roles => roles.map(role => role.id));

        this.logger.info('Fetching categories for user', {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            panelId,
            roles: roleIds,
        });

        // Get each of the categories
        const categories = await db
            .selectFrom('categories')
            .select('id')
            .select('name')
            .where('panelId', '=', panelId)
            .where('enabled', '=', true)
            .where(({ or, cmpr, not }) =>
                or([
                    cmpr('prohibitedRoleIds', '=', sql`JSON_ARRAY()`),
                    not(
                        or([
                            ...roleIds.map(
                                roleId =>
                                    sql<boolean>`JSON_CONTAINS(prohibited_role_ids, ${JSON.stringify([
                                        roleId,
                                    ])})`,
                            ),
                        ]),
                    ),
                ]),
            )
            .where(({ or, cmpr }) =>
                or([
                    cmpr('requiredRoleIds', '=', sql`JSON_ARRAY()`),
                    ...roleIds.map(
                        roleId =>
                            sql<boolean>`JSON_CONTAINS(required_role_ids, ${JSON.stringify([
                                roleId,
                            ])})`,
                    ),
                ]),
            )
            .execute();

        this.logger.info('Fetched categories for user', {
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            categories,
        });

        // Show the dropdown menu
        await interaction.editReply({
            content: 'Please select a category',
            components: [
                new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('create-a-ticket-category')
                            .setPlaceholder('Select a category')
                            .addOptions(categories.map(category => new StringSelectMenuOptionBuilder()
                                .setLabel(category.name)
                                .setValue(category.id),
                            )),
                    ),
            ],
        });
    }

    @SelectMenuComponent({
        id: 'create-a-ticket-category',
    })
    async createATicketCategory(interaction: StringSelectMenuInteraction) {
        // If this is not in a guild and channel, ignore it
        if (!interaction.guild) return;
        if (!interaction.channel) return;

        // Show the bot is thinking
        await interaction.deferUpdate();

        // Get the category ID from the button's custom ID
        const categoryId = interaction.values[0];
        if (!categoryId) throw new Error('Invalid category ID');

        // Let the user know their ticket is being created
        await interaction.editReply({
            content: 'https://media.tenor.com/Z8SwGzcIitEAAAAC/just-give-me-a-minute-hang-on.gif',
            components: [],
        });

        // Create the ticket
        const ticketChannel = await this.createTicket(interaction.guild, interaction.user, categoryId);

        // Send the ticket created message
        await interaction.editReply({
            content: `Your ticket has been created: <#${ticketChannel.id}>`,
            components: [],
        });
    }

    async getNextTicketNumber(guildId: string): Promise<number> {
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
    }

    async createTicket(guild: Guild, user: User, categoryId: string): Promise<TextChannel> {
        const botUserId = this.client.user?.id;
        if (!botUserId) throw new Error('Bot is still starting');

        // Get the next ticket number
        const ticketNumber = await this.getNextTicketNumber(guild.id);

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
            })
            .execute();

        this.logger.info('Creating ticket', {
            userId: user.id,
            guildId: guild.id,
            ticketNumber,
            ticketId,
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

        this.logger.info('Creating ticket admin message', {
            userId: user.id,
            guildId: guild.id,
            ticketNumber,
            ticketId,
        });

        // Create a message for the staff to see
        const ticketAdminMessage = await (guild.channels.cache.get(category.ticketAdminChannelId) as TextChannel).send(this.generateAdminTicketMessage({
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
    }

    @ButtonComponent({
        id: createRegex('close-ticket'),
    })
    async closeTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket ID from the button's custom ID
        const ticketId = parse('close-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('ownerId')
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
        await message?.edit(this.generateAdminTicketMessage({
            categoryName: category.name,
            createdById: ticket.ownerId,
            status: 'CLOSED',
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            claimedById: ticket.claimedById,
            note: `Ticket was closed by <@${interaction.user.id}>`
        }));

        // Get the ticket channel
        const channel = await this.getTicketChannel(interaction.user.id, interaction.guild, ticket.id, category.name, ticket.ticketNumber);

        // If the channel doesn't exist, just send the ticket closed message
        if (!channel) {
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
            await channel.delete();
        } catch { }

        // Send the ticket closed message
        if (interaction.channelId !== channel.id) {
            await interaction.editReply({
                content: `Ticket #${ticket.ticketNumber} has been closed.`,
                components: [],
            });
        }

        // Update the database
        await db
            .updateTable('tickets')
            .set({
                claimedById: undefined,
                state: 'CLOSED',
            })
            .where('id', '=', ticket.id)
            .execute();
    }

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
        const ticketId = parse('close-and-save-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('ticketAdminMessageId')
            .select('ticketNumber')
            .select('categoryId')
            .where('id', '=', ticketId)
            .executeTakeFirstOrThrow();

        // Get the ticket's category
        const category = await db
            .selectFrom('categories')
            .select('name')
            .select('transcriptionsChannelId')
            .where('id', '=', ticket.categoryId)
            .executeTakeFirstOrThrow();

        // Get the ticket channel
        const channel = await this.getTicketChannel(interaction.user.id, interaction.guild, ticket.id, category.name, ticket.ticketNumber);

        // If the channel doesn't exist, just send the ticket closed message
        if (!channel) {
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
        const messages = await channel.messages.fetch({ limit: 100 });

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

        return this.closeTicket(interaction);
    }

    @ButtonComponent({
        id: createRegex('claim-ticket'),
    })
    async claimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket ID from the button's custom ID
        const ticketId = parse('claim-ticket', interaction.customId).uuid;
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
        if (claimedTickets >= 5) {
            await interaction.editReply({
                content: 'You can only claim 5 tickets at at time',
                components: [],
            });
            return;
        }

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('ownerId')
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
        const channel = await this.getTicketChannel(interaction.user.id, interaction.guild, ticket.id, category.name, ticket.ticketNumber);

        // Check that ticket admin message has been created
        if (!ticket.ticketAdminMessageId) throw new Error('Ticket is still being created');

        // Check if the ticket's channel still exists
        if (!channel) {
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
        await message?.edit(this.generateAdminTicketMessage({
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
        await channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        });

        // Delete the unclaimed ticket message
        const unclaimedTicketMessage = await channel.messages.fetch({ limit: 100 }).then(messages => messages.find(message => message.embeds[0]?.title === 'Ticket unclaimed'));
        if (unclaimedTicketMessage) await unclaimedTicketMessage.delete();

        // Let the user know the ticket has been claimed
        await channel.send({
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
            content: `Ticket #${ticket.ticketNumber} has been claimed, you can now view and reply to it in <#${channel.id}>`,
            components: [],
        });
    }

    @ButtonComponent({
        id: createRegex('unclaim-ticket'),
    })
    async unclaimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferUpdate();

        // Get the ticket ID from the button's custom ID
        const ticketId = parse('unclaim-ticket', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
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
        const channel = await this.getTicketChannel(interaction.user.id, interaction.guild, ticket.id, category.name, ticket.ticketNumber);

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

    @ButtonComponent({
        id: createRegex('staff-tools'),
    })
    async staffTools(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        await interaction.deferReply({ ephemeral: true });

        // Get the member
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Get the ticket ID from the button's custom ID
        const ticketId = parse('staff-tools', interaction.customId).uuid;
        if (!ticketId) throw new Error('Invalid ticket ID');

        // Get the ticket
        const ticket = await db
            .selectFrom('tickets')
            .select('id')
            .select('ticketAdminMessageId')
            .select('ticketNumber')
            .select('panelId')
            .where('id', '=', ticketId)
            .executeTakeFirstOrThrow();

        // Get the panel for this ticket
        const panel = await db
            .selectFrom('panels')
            .select('managerRoleIds')
            .where('id', '=', ticket.panelId)
            .executeTakeFirstOrThrow();

        // Check the user has at least one of the manager roles
        if (!member.roles.cache.some(role => panel.managerRoleIds.includes(role.id))) {
            await interaction.editReply({
                content: 'You do not have permission to use this button',
                components: [],
            }).catch(error => {
                // If the message was deleted, ignore it
                if (error instanceof DiscordAPIError && error.code === 10008) return;
            });
            return;
        }

        // Send the staff tools message
        await interaction.editReply({
            embeds: [{
                title: 'Staff tools',
                description: `Hey ${interaction.user.username}, what would you like to do with this ticket?`,
            }],
            components: [
                new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(generateInputString('close-ticket', ticket.id, { action: 'update' }))
                            .setLabel('Close ticket')
                            .setEmoji('🔒')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(generateInputString('close-and-save-ticket', ticket.id, { action: 'update' }))
                            .setLabel('Close ticket and save transcript')
                            .setEmoji('💾')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(generateInputString('unclaim-ticket', ticket.id))
                            .setLabel('Unclaim ticket')
                            .setEmoji('🙅‍♀️')
                            .setStyle(ButtonStyle.Secondary)
                    )
            ],
        });
    }
}
