import 'reflect-metadata';
import { globalLogger } from '@app/logger';
import { env } from '@app/env';
import pkg from '../package.json';
import { client } from '@app/client';

const { name } = pkg;

export const start = async () => {
    globalLogger.info('Starting "%s" in "%s" mode with a log level of "%s".', name, env.NODE_ENV, env.LOG_LEVEL);

    // Load all the events, commands and api
    await import('./features/tickets');

    // Connect to the discord gateway
    await client.login(env.BOT_TOKEN);
};
