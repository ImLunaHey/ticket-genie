import { DiscordEvent } from '@app/models/discord-event';
import type { Guild } from 'discord.js';
import { Discord, On } from 'discordx';

@Discord()
export class GuildDeleteEvent extends DiscordEvent {
    service = 'guild-delete';

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
}