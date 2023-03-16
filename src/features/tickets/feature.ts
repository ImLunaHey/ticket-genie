import { client } from '@app/client';
import { globalLogger } from '@app/logger';
import { ButtonComponent, Discord, Guild as GuildGuard, On, SelectMenuComponent } from 'discordx';
import { outdent } from 'outdent'
import type { TextChannel, User, Guild, Message } from 'discord.js';
import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, StringSelectMenuInteraction, PermissionFlagsBits, Colors, AttachmentBuilder, EmbedBuilder, DiscordAPIError } from 'discord.js';

// The guild
const guildId = '927461441051701280';

// Everyone
let createATicketChannelId = '1085374793416712232';

// Ticket author + mod who accepted ticket per channel
let ticketsCategoryId = '1085373347174551562';

// Verified role
const verifiedRoleId = '965589467832401950';

// Needed roles to verify, any of these and you'll be able to verify
const verifyRoleIds = ['960100946971607080', '957109628582367262', '927532000330539068', '927532070216011806', '969550549122945074', '1009015173484392478'];

// Staff
const staffRoleId = '965591036711800842';
let staffCategoryId = '1085374959611814009';
let staffTicketsChannelId = '1085375115233087488';
let archivedTicketsChannelId = '1085375283886030989';

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
@GuildGuard(guildId)
export class Feature {
    private client = client;
    private logger = globalLogger.scope('Tickets');
    private currentTicketNumber: number;

    constructor() {
        this.logger.success('Feature initialized');
    }

    async setupChannels() {
        // Get the guild
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            this.logger.error('Guild not found');
            return;
        }

        // Make sure the create a ticket channel exists
        const createATicketChannel = this.client.channels.cache.get(createATicketChannelId) ?? await this.client.channels.fetch(createATicketChannelId);
        if (!createATicketChannel) {
            this.logger.error('Create a ticket channel not found');
            this.logger.info('Creating create a ticket channel');
            const channel = await guild.channels.create({
                type: ChannelType.GuildText,
                name: 'create-a-ticket',
                parent: ticketsCategoryId,
            });
            createATicketChannelId = channel.id;
        }

        // Make sure the staff tickets channel exists
        const staffTicketsChannel = this.client.channels.cache.get(staffTicketsChannelId) ?? await this.client.channels.fetch(staffTicketsChannelId);
        if (!staffTicketsChannel) {
            this.logger.error('Staff tickets channel not found');
            this.logger.info('Creating staff tickets channel');
            const channel = await guild.channels.create({
                type: ChannelType.GuildText,
                name: 'tickets',
                parent: staffCategoryId,
            });
            staffTicketsChannelId = channel.id;
        }

        // Make sure the archived tickets channel exists
        const archivedTicketsChannel = this.client.channels.cache.get(archivedTicketsChannelId) ?? await this.client.channels.fetch(archivedTicketsChannelId);
        if (!archivedTicketsChannel) {
            this.logger.error('Archived tickets channel not found');
            this.logger.info('Creating archived tickets channel');
            const channel = await guild.channels.create({
                type: ChannelType.GuildText,
                name: 'archived-tickets',
                parent: staffCategoryId,
            });
            archivedTicketsChannelId = channel.id;
        }
    }

    async setupCategories() {
        // Get the guild
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            this.logger.error('Guild not found');
            return;
        }

        // Make sure the tickets category exists
        const ticketsCategory = this.client.channels.cache.get(ticketsCategoryId) ?? await this.client.channels.fetch(ticketsCategoryId);
        if (!ticketsCategory) {
            this.logger.error('Tickets category not found');
            this.logger.info('Creating tickets category');
            const category = await guild.channels.create({
                name: 'Tickets',
                type: ChannelType.GuildCategory,
            });
            ticketsCategoryId = category.id;
        }

        // Make sure the ticket admin category exists
        const ticketAdminCategory = this.client.channels.cache.get(staffCategoryId) ?? await this.client.channels.fetch(staffCategoryId);
        if (!ticketAdminCategory) {
            this.logger.error('Ticket admin category not found');
            this.logger.info('Creating ticket admin category');
            const category = await guild.channels.create({
                name: 'Ticket Admin',
                type: ChannelType.GuildCategory,
            });
            staffCategoryId = category.id;
        }
    }

    setupPermissions() {
        // Get the guild
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            this.logger.error('Guild not found');
            return;
        }

        // TODO: Setup permissions
    }

    async setupCreateATicketMessage() {
        // Get the guild
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            this.logger.error('Guild not found');
            return;
        }

        // Get the channel
        const channel = (this.client.channels.cache.get(createATicketChannelId) ?? await this.client.channels.fetch(createATicketChannelId)) as TextChannel;

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
                            .setCustomId('create-a-ticket')
                            .setLabel('Create a ticket')
                            .setEmoji('🎫')
                            .setStyle(ButtonStyle.Primary)
                    )
            ],
        });
    }

    async updateTicketNumber() {
        // Get the guild
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            this.logger.error('Guild not found');
            return;
        }

        // Get the last ticket's number
        const messages = await (guild.channels.cache.get(staffTicketsChannelId) as TextChannel).messages.fetch({
            limit: 1,
        });

        // Either get the ticket number from the last ticket, or use 0
        this.currentTicketNumber = Number(messages.first()?.embeds[0].footer?.text.match(/Ticket #(\d+)/)?.[1] ?? '0');
    }

    @On({
        event: 'ready',
    })
    async ready() {
        this.logger.success('Ready');

        // Fetch the needed channels
        await client.guilds.cache.get(guildId)?.channels.fetch();

        // Setup the categories
        await this.setupCategories();

        // Setup the channels
        await this.setupChannels();

        // Make sure permissions are correct
        this.setupPermissions();

        // Make sure the create a ticket channel has a "create a ticket" message
        await this.setupCreateATicketMessage();

        // Update the ticket number
        await this.updateTicketNumber();
    }

    @ButtonComponent({
        id: 'create-a-ticket',
    })
    async createATicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;
        const member = interaction.member;
        if (!member) return;

        // Show the bot is thinking
        await interaction.deferReply({ ephemeral: true });

        // Check if they can verify
        const isLevelToVerify = verifyRoleIds.some(roleId => Array.isArray(member.roles) ? member.roles.includes(roleId) : member.roles.cache.has(roleId));
        const isVerified = verifiedRoleId ? Array.isArray(member.roles) ? member.roles.includes(verifiedRoleId) : member.roles.cache.has(verifiedRoleId) : false;

        // Check if they're already verified, if so don't give them the option to open a verification ticket
        if (isVerified || !isLevelToVerify) {
            // Show the dropdown menu
            await interaction.editReply({
                content: 'Please select a category',
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('create-a-ticket-category')
                                .setPlaceholder('Select a category')
                                .addOptions([
                                    new StringSelectMenuOptionBuilder()
                                        .setLabel('Support')
                                        .setValue('support'),
                                ])
                        )
                ]
            });
            return;
        }

        // Show the dropdown menu
        await interaction.editReply({
            content: 'Please select a category',
            components: [
                new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('create-a-ticket-category')
                            .setPlaceholder('Select a category')
                            .addOptions([
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('Support')
                                    .setValue('support'),
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('Verification')
                                    .setValue('verification'),
                            ])
                    )
            ]
        });
    }

    @SelectMenuComponent({
        id: 'create-a-ticket-category',
    })
    async createATicketCategory(interaction: StringSelectMenuInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        await interaction.deferUpdate();

        // Get the category
        const category = interaction.values[0] as 'support' | 'verification';

        // Create the ticket
        const ticket = await this.createTicket(interaction.guild, interaction.user, category);

        // Send the ticket created message
        await interaction.editReply({
            content: `Your ticket has been created: <#${ticket.channel.id}>`,
            components: [],
        });
    }

    async createTicket(guild: Guild, user: User, category: 'support' | 'verification'): Promise<Message<true>> {
        const ticketNumber = this.currentTicketNumber += 1;
        this.logger.info(`Creating ticket #${ticketNumber} for ${user.tag} (${user.id})`);

        // The bot gets this on login
        if (!this.client.user) throw new Error('Bot is still starting up');

        // Get the @everyone role
        if (!guild.roles.everyone?.id) await guild.roles.fetch('@everyone');

        // Create the channel
        const channel = await guild.channels.create({
            name: `ticket-${ticketNumber}`,
            type: ChannelType.GuildText,
            parent: ticketsCategoryId,
            nsfw: category === 'verification',
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
                    id: this.client.user.id,
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

        // Create a message for the staff to see
        await (guild.channels.cache.get(staffTicketsChannelId) as TextChannel).send({
            embeds: [{
                title: `New ${category} ticket`,
                description: `Ticket #${ticketNumber} has been created by <@${user.id}>`,
                color: Colors.Aqua,
                footer: {
                    text: `Ticket #${ticketNumber}`,
                },
            }],
            components: [
                new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`close-and-save-ticket [${ticketNumber}] [reply]`)
                            .setLabel('Close & save')
                            .setEmoji('💾')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`close-ticket [${ticketNumber}]`)
                            .setLabel('Close ticket')
                            .setEmoji('🔒')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`claim-ticket [${ticketNumber}]`)
                            .setLabel('Claim ticket')
                            .setEmoji('🙋‍♀️')
                            .setStyle(ButtonStyle.Success),
                    )
            ],
        });

        switch (category) {
            case 'support':
                // Send the welcome message
                return await channel.send({
                    embeds: [{
                        title: 'Welcome to the support ticket',
                        description: 'Please describe your issue, and we will get back to you as soon as possible.',
                        color: Colors.Aqua,
                        footer: {
                            text: `Ticket #${ticketNumber}`,
                        },
                    }],
                    components: [
                        new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`close-ticket [${ticketNumber}]`)
                                    .setLabel('Close ticket')
                                    .setEmoji('🔒')
                                    .setStyle(ButtonStyle.Danger),
                                new ButtonBuilder()
                                    .setCustomId(`staff-tools [${ticketNumber}]`)
                                    .setLabel('Staff tools')
                                    .setEmoji('🛠️')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                    ],
                });
            case 'verification':
                // Send the welcome message
                return channel.send({
                    embeds: [{
                        title: 'Welcome to the verification ticket',
                        description: outdent`
                            Please send the following to be verified.

                            1. A photo of you holding your ID showing just the date of birth and the photo, everything else should be covered.
                            2. A photo of you holding a piece of paper with your discord username and today's date written on it.
                        `,
                        color: Colors.Aqua,
                        footer: {
                            text: `Ticket #${ticketNumber}`,
                        },
                    }],
                    components: [
                        new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`close-ticket [${ticketNumber}]`)
                                    .setLabel('Close ticket')
                                    .setEmoji('🔒')
                                    .setStyle(ButtonStyle.Danger),
                                new ButtonBuilder()
                                    .setCustomId(`staff-tools [${ticketNumber}]`)
                                    .setLabel('Staff tools')
                                    .setEmoji('🛠️')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                    ],
                });
        }
    }

    @ButtonComponent({
        id: /^close-ticket \[(\d+)\]/,
    })
    async closeTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket number        // Get the ticket number
        const ticketNumber = Number(interaction.customId.match(/^close-ticket \[(\d+)\]/)?.[1] ?? interaction.customId.match(/^close-and-save-ticket \[(\d+)\]/)?.[1]);
        if (!ticketNumber) return;

        this.logger.info(`Closing ticket #${ticketNumber} for ${interaction.user.tag} (${interaction.user.id})`);

        // Get the ticket channel
        const channel = interaction.guild.channels.cache.find(channel => channel.name === `ticket-${ticketNumber}`) as TextChannel;

        // Update the tickets channel
        const messages = await (interaction.guild.channels.cache.get(staffTicketsChannelId) as TextChannel).messages.fetch({ limit: 100 });
        const message = messages.find(message => message.embeds[0]?.footer?.text === `Ticket #${ticketNumber}`);
        if (message) {
            await message.edit({
                embeds: [{
                    title: 'Closed ticket',
                    description: `Ticket #${ticketNumber} has been closed by <@${interaction.user.id}>`,
                    color: Colors.Aqua,
                    footer: {
                        text: `Ticket #${ticketNumber}`,
                    },
                }],
                components: [],
            });
        }

        // If the channel doesn't exist, just send the ticket closed message
        if (!channel) {
            // Send the ticket closed message
            await interaction.editReply({
                content: `Ticket #${ticketNumber} has been closed.`,
                components: [],
            });
            return;
        }

        // Send the ticket closed message
        await interaction.editReply({
            content: `Closing ticket #${ticketNumber} in 5 seconds...`,
            components: [],
        });

        // Wait 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            // Delete the channel
            await channel.delete();
        } catch { }

        // Send the ticket closed message
        if (interaction.channelId !== channel.id) {
            await interaction.editReply({
                content: `Ticket #${ticketNumber} has been closed.`,
                components: [],
            });
        }
    }

    @ButtonComponent({
        id: /^close-and-save-ticket \[(\d+)\] \[(update|reply)\]/,
    })
    async closeAndSaveTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) {
            if (interaction.customId.match(/^close-and-save-ticket \[(\d+)\] \[(update|reply)\]/)?.[2] === 'update') await interaction.deferUpdate();
            else await interaction.deferReply({ ephemeral: true });
        }

        // Get the ticket number
        const ticketNumber = Number(interaction.customId.match(/^close-and-save-ticket \[(\d+)\] \[(update|reply)\]/)?.[1]);
        if (!ticketNumber) return;

        // Get the ticket channel
        const channel = interaction.guild.channels.cache.find(channel => channel.name === `ticket-${ticketNumber}`) as TextChannel;

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
                    name: `ticket-${ticketNumber}-transcript-part-${index}.txt`,
                }));
            }
        }

        // Send the message to the archived tickets channel
        await (interaction.guild.channels.cache.get(archivedTicketsChannelId) as TextChannel).send({
            embeds: [{
                title: `Ticket #${ticketNumber} transcript`,
                description: `Ticket #${ticketNumber} has been closed and saved by <@${interaction.user.id}>`,
                color: Colors.Aqua,
                footer: {
                    text: `Ticket #${ticketNumber}`,
                },
            }],
            files,
        });

        return this.closeTicket(interaction);
    }

    @ButtonComponent({
        id: /^claim-ticket \[(\d+)\]/,
    })
    async claimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });

        // Get the ticket number
        const ticketNumber = Number(interaction.customId.match(/^claim-ticket \[(\d+)\]/)?.[1]);

        // If the ticket number is invalid, ignore it
        if (!ticketNumber) return;

        // Get the ticket channel
        const channel = interaction.guild.channels.cache.find(channel => channel.name === `ticket-${ticketNumber}`) as TextChannel;

        // Update the tickets channel
        const messages = await (interaction.guild.channels.cache.get(staffTicketsChannelId) as TextChannel).messages.fetch({ limit: 100 });
        const message = messages.find(message => message.embeds[0]?.footer?.text === `Ticket #${ticketNumber}`);
        if (message) {
            await message.edit({
                embeds: [{
                    title: 'Claimed ticket',
                    description: `Ticket #${ticketNumber} has been claimed by <@${interaction.user.id}>`,
                    color: Colors.Aqua,
                    footer: {
                        text: `Ticket #${ticketNumber}`,
                    },
                }],
                components: [
                    new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`close-and-save-ticket [${ticketNumber}] [reply]`)
                                .setLabel('Close & save')
                                .setEmoji('💾')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`close-ticket [${ticketNumber}]`)
                                .setLabel('Close ticket')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`claim-ticket [${ticketNumber}]`)
                                .setLabel(`Claimed by ${interaction.user.username}`)
                                .setEmoji('🙋‍♀️')
                                .setDisabled(true)
                                .setStyle(ButtonStyle.Secondary),
                        )
                ],
            });
        }

        // Check if the ticket's channel still exists
        if (!channel) {
            // Reply with an error message
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Ticket not found')
                        .setDescription(`Ticket #${ticketNumber} could not be found, it may have already been closed.`)
                        .setColor(Colors.Red)
                        .setTimestamp(new Date())
                        .setFooter({
                            text: `Ticket #${ticketNumber}`,
                        }),
                ],
                components: [],
            });
            return;
        }

        this.logger.info(`Claiming ticket #${ticketNumber} for ${interaction.user.tag} (${interaction.user.id})`);

        // Update the channel permissions
        await channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        });

        // Delete the unclaimed ticket message
        const messages2 = await channel.messages.fetch({ limit: 100 });
        const message2 = messages2.find(message => message.embeds[0]?.title === 'Ticket unclaimed');
        if (message2) await message2.delete();

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
            content: `Ticket #${ticketNumber} has been claimed, you can now view and reply to it in <#${channel.id}>`,
            components: [],
        });
    }

    @ButtonComponent({
        id: /^unclaim-ticket \[(\d+)\]/,
    })
    async unclaimTicket(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        if (!interaction.deferred) await interaction.deferUpdate();

        // Get the ticket number
        const ticketNumber = Number(interaction.customId.match(/^unclaim-ticket \[(\d+)\]/)?.[1]);

        // If the ticket number is invalid, ignore it
        if (!ticketNumber) return;

        // Get the ticket channel
        const channel = interaction.guild.channels.cache.find(channel => channel.name === `ticket-${ticketNumber}`) as TextChannel;

        // Update the channel permissions
        // TODO: Fix this
        await channel.permissionOverwrites.cache.find(override => override.id === interaction.user.id)?.delete();

        // Update the tickets channel
        const messages = await (interaction.guild.channels.cache.get(staffTicketsChannelId) as TextChannel).messages.fetch({ limit: 100 });
        const message = messages.find(message => message.embeds[0]?.footer?.text === `Ticket #${ticketNumber}`);
        if (message) {
            await message.edit({
                embeds: [{
                    title: 'Unclaimed ticket',
                    description: `Ticket #${ticketNumber} is open and unclaimed`,
                    color: Colors.Aqua,
                    footer: {
                        text: `Ticket #${ticketNumber}`,
                    },
                    timestamp: new Date().toISOString(),
                }],
                components: [
                    new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`close-and-save-ticket [${ticketNumber}] [reply]`)
                                .setLabel('Close & save')
                                .setEmoji('💾')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`close-ticket [${ticketNumber}]`)
                                .setLabel('Close ticket')
                                .setEmoji('🔒')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`claim-ticket [${ticketNumber}]`)
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
                    .setDescription(`Ticket #${ticketNumber} has been unclaimed`)
                    .setColor(Colors.Aqua)
                    .setFooter({
                        text: `Ticket #${ticketNumber}`,
                    }),
            ],
            components: [],
        });
    }

    @ButtonComponent({
        id: /^staff-tools \[(\d+)\]/,
    })
    async staffTools(interaction: ButtonInteraction) {
        // If this is not in a guild, ignore it
        if (!interaction.guild) return;

        // Show the bot is thinking
        await interaction.deferReply({ ephemeral: true });

        // Get the member
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Get the @everyone role
        if (!interaction.guild.roles.everyone) await interaction.guild.roles.fetch('@everyone');

        // Check the user is a staff member
        if (!member.roles.cache.has(staffRoleId)) {
            await interaction.editReply({
                content: 'You do not have permission to use this button',
                components: [],
            }).catch(error => {
                // If the message was deleted, ignore it
                if (error instanceof DiscordAPIError && error.code === 10008) return;
            });
            return;
        }

        // Get the ticket number
        const ticketNumber = Number(interaction.customId.match(/^staff-tools \[(\d+)\]/)?.[1]);

        // If the ticket number is invalid, ignore it
        if (!ticketNumber) return;

        // Send the staff tools message
        await interaction.editReply({
            embeds: [{
                title: 'Staff tools',
                description: `Hey ${interaction.user.username}, what would you like to do with ticket #${ticketNumber}?`,
            }],
            components: [
                new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`close-and-save-ticket [${ticketNumber}] [update]`)
                            .setLabel('Close and save ticket')
                            .setEmoji('🔒')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`unclaim-ticket [${ticketNumber}]`)
                            .setLabel('Unclaim ticket')
                            .setEmoji('🔓')
                            .setStyle(ButtonStyle.Secondary)
                    )
            ],
        });
    }
}
