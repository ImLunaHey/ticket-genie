import { db } from '@app/common/database';
import { DiscordEvent } from '@app/models/discord-event';
import type { Guild, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { Discord, On } from 'discordx';

@Discord()
export class GuildCreateEvent extends DiscordEvent {
    service = 'guild-create';

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
}
