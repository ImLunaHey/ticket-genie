import { client } from '@app/client';
import { globalLogger } from '@app/logger';

export abstract class DiscordEvent {
    client = client;
    service: string;
    logger: typeof globalLogger;

    constructor() {
        this.logger = globalLogger.child({
            service: `event:${this.service}`,
        });
    }
}
