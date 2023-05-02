import { PlanetScaleDialect } from 'kysely-planetscale';
import { fetch } from 'undici';
import { CamelCasePlugin, Kysely } from 'kysely';
import type { Generated, RawBuilder, ColumnType } from 'kysely';

type Category = {
    // Random UUID
    id: Generated<string>;

    // Whether this ticket category is enabled
    enabled: boolean;

    // User friendly name
    // This is shown in the dropdown
    name: string;

    // The emoji to display
    // If this is a NSFW category and there is no emoji it'll default to 🔞
    emoji?: string;

    /**
     * The message to send when the ticket is created  
     * [verification-tickets]  
     * create-a-ticket <--- The message is posted in here after pushing the "create a ticket" button  
     * ticket-001  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]  
     * tickets  
     * archived-tickets  
     * [other-category]  
     */
    replyMessage?: string;

    /**
     * The message posted in the ticket channel after creation  
     * [verification-tickets]  
     * create-a-ticket  
     * ticket-001 <--- The message is posted in here  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]  
     * tickets  
     * archived-tickets  
     * [other-category]  
     */
    ticketMessage: string;

    /**
     * The discord category where tickets are created for this category  
     * [verification-tickets] <--- This  
     * create-a-ticket  
     * ticket-001  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]  
     * tickets  
     * archived-tickets  
     * [other-category]  
     */
    parentChannelId: string;

    /**
     * The discord channel where tickets go for staff to deal with  
     * [verification-tickets]  
     * create-a-ticket  
     * ticket-001  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]  
     * tickets <--- This  
     * archived-tickets  
     * [other-category]  
     */
    ticketAdminChannelId: string;

    /**
     * The discord channel where transcriptions go
     * [verification-tickets]  
     * create-a-ticket  
     * ticket-001  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]
     * tickets  
     * transcriptions <--- This  
     * [other-category]  
     */
    transcriptionsChannelId: string;

    /**
     * If the ticket channel that's created should be marked as NSFW  
     * [verification-tickets]
     * create-a-ticket  
     * ticket-001 <--- This  
     * ticket-002  
     * [support]  
     * create-a-ticket  
     * ticket-001  
     * ticket-008  
     * [ticket-admin]  
     * tickets  
     * archived-tickets  
     * [other-category]  
     */
    nsfw: boolean;

    // Roles that are required to create this ticket
    // If empty, anyone can create this ticket
    // If not empty the user needs ANY of the roles
    // Tickets that can't be created won't be displayed in the panel's drop down
    requiredRoleIds: ColumnType<string[], RawBuilder<string[]>, RawBuilder<string[]>>;

    // Roles that are not allowed to create this ticket
    // If empty, anyone can create this ticket
    // If not empty the user cannot have ANY of the roles
    // Tickets that can't be created won't be displayed in the panel's drop down
    prohibitedRoleIds: ColumnType<string[], RawBuilder<string[]>, RawBuilder<string[]>>;

    // Which panel this ticket category is for
    panelId: string;
};

type Ticket = {
    // Random UUID
    id: Generated<string>;

    // The numerical ticket number
    ticketNumber: number;

    // Which category this ticket is in
    categoryId: string;

    // Which panel this ticket is for
    panelId: string;

    // What state the ticket is currently in
    state: 'OPEN' | 'CLOSED';

    // Which guild this ticket is in
    guildId: string;

    // The member who owns this ticket
    // This is the will the either the member who created it
    // or if a staff creates this for a member it'll be that member
    ownerId: string;

    // The staff member who claimed this ticket
    claimedById: ColumnType<string, string | null, string | null>;

    // The staff members who have been pulled
    // into this ticket who aren't the claimer
    staffMemberIds?: ColumnType<string[], RawBuilder<string[]>, RawBuilder<string[]>>;

    // The discord snowflake of the "ticket admin" message
    ticketAdminMessageId?: string;
};

type GuildMember = {
    // The discord snowflake
    id: Generated<string>;

    // Which guild the member is in
    guildId: string;
};

type Guild = {
    // The discord snowflake
    id: Generated<string>;

    // Current ticket number
    ticketNumber: number;

    // If this guild is enabled or not
    // This toggled to "false" if we have an issue getting the guild from discord
    enabled?: boolean;
};

type Panel = {
    // Random UUID
    id: Generated<string>;

    // Whether this panel is enabled
    enabled?: boolean;

    // Which guild this panel is for
    guildId: string;

    // The channel where the panel is posted
    channelId: string;

    // The role that can manage these tickets
    managerRoleIds: ColumnType<string[], RawBuilder<string[]>, RawBuilder<string[]>>;

    // These are all shown in the dropdown for this panel
    // If there is only one there won't be a dropdown
    categoryIds: string[];

    // The "create a ticket" button
    buttonMessage?: string;
};

// Keys of this are table names.
export type Database = {
    categories: Category;
    tickets: Ticket;
    guildMembers: GuildMember;
    guilds: Guild;
    panels: Panel;
};

export const db = new Kysely<Database>({
    dialect: new PlanetScaleDialect({
        url: process.env.DATABASE_URL,
        fetch,
    }),
    plugins: [
        new CamelCasePlugin(),
    ],
});
