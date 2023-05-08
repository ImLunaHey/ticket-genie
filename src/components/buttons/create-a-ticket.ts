import { createRegex } from '@app/common/create-regex';
import { db } from '@app/common/database';
import { parseCustomId } from '@app/common/parse-custom-id';
import { DiscordButton } from '@app/models/discord-button';
import type { Guild, GuildMemberRoleManager, Role } from 'discord.js';
import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { ButtonInteraction, Collection } from 'discord.js';
import { ButtonComponent, Discord } from 'discordx';
import { sql } from 'kysely';

const resolveRoles = async (guild: Guild, roles: GuildMemberRoleManager | string[] | null | undefined) => {
    if (!roles) return new Collection<string, Role>();
    if (Array.isArray(roles)) return guild.roles.fetch();
    return roles.cache;
};

@Discord()
export class CreateATicketButton extends DiscordButton {
    service = 'create-a-ticket';

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
        const panelId = parseCustomId('create-a-ticket', interaction.customId).uuid;

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
}