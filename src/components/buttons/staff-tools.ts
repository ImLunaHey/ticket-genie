import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { generateInputString } from '@app/common/generate-input-string';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import { ButtonInteraction, DiscordAPIError, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';

@Discord()
export class StaffToolsButton extends DiscordButton {
    constructor() {
        super('staff-tools');
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
        const ticketId = parseCustomId('staff-tools', interaction.customId).uuid;
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
