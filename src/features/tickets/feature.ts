import { globalLogger } from '@app/logger';
import { Discord } from 'discordx';

@Discord()
export class Feature {
    private logger = globalLogger.scope('Tickets');

    constructor() {
        this.logger.success('Feature initialized');
    }
}
