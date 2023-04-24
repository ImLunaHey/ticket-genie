import 'reflect-metadata';
import { globalLogger } from '@app/logger';
import { env } from '@app/env';
import pkg from '../package.json';
import { client } from '@app/client';

const { name } = pkg;

export const startBot = async () => {
    globalLogger.info('Starting bot', {
        name,
        env: env.NODE_ENV,
        logLevel: env.LOG_LEVEL,
    });

    // Load all the events, commands and api
    await import('./features/tickets');

    // Connect to the discord gateway
    await client.login(env.BOT_TOKEN);
};
