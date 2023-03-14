import { Partials } from 'discord.js';
import { createDiscordClient } from '@app/common/discord-client';
import pkg from '../package.json';

const { name } = pkg;

export const client = createDiscordClient(name, {
    intents: [],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.GuildScheduledEvent,
        Partials.Message,
        Partials.Reaction,
        Partials.ThreadMember,
        Partials.User,
    ],
});
