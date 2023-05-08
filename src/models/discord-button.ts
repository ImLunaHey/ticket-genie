import { client } from '@app/client';
import { globalLogger } from '@app/logger';

export abstract class DiscordButton {
    client = client;
    service: string;
    logger: typeof globalLogger;

    constructor() {
        this.logger = globalLogger.child({
            service: `button:${this.service}`,
        });
    }
}
