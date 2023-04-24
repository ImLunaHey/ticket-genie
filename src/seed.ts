import 'dotenv/config';
import { db } from '@app/common/database';
import outdent from 'outdent';
import type { RawBuilder } from 'kysely';
import { sql } from 'kysely';

const guildId = '927461441051701280';
const ticketPanelId = '62b8d5aa-c64f-43b6-ba4d-db3d8b4fe404';
const supportCategoryId = '8257dcf3-9f02-47e9-8000-ca7919fd2eda';
const verificationCategoryId = '24178f51-6bdb-472c-b3cc-30bf9354f1e7';

const json = <T>(value: T): RawBuilder<T> => sql`CAST(${JSON.stringify(value)} AS JSON)`;

export const seedDatabase = async () => {
    // This will seed data for luna's lobby
    // This should be removed before going stable
    console.log('Seeding database');

    // Create the guild
    console.log('Creating the guild');
    await db
        .insertInto('guilds')
        .ignore()
        .values({
            id: guildId,
            enabled: true,
            ticketNumber: 0,
        })
        .execute();
    console.log('done');

    // Create the support category
    console.log('Creating the "support" category');
    const query = db
        .insertInto('categories')
        .ignore()
        .values({
            id: supportCategoryId,
            name: 'Support',
            enabled: true,
            nsfw: false,
            parentChannelId: '1085373347174551562',
            requiredRoleIds: json([]),
            prohibitedRoleIds: json([]),
            ticketAdminChannelId: '1085375115233087488',
            ticketMessage: 'Please describe your issue, and we will get back to you as soon as possible.',
            transcriptionsChannelId: '1085375283886030989',
            emoji: '❔',
            panelId: ticketPanelId,
        });
    await query.execute();
    console.log('done');

    // Create the verification category
    console.log('Creating the "verification" category');
    await db
        .insertInto('categories')
        .ignore()
        .values({
            id: verificationCategoryId,
            name: 'Verification',
            enabled: true,
            nsfw: false,
            parentChannelId: '1085373347174551562',
            requiredRoleIds: json([
                '960100946971607080',
                '957109628582367262',
                '927532000330539068',
                '927532070216011806',
                '969550549122945074',
                '1009015173484392478'
            ]),
            prohibitedRoleIds: json([
                '965589467832401950'
            ]),
            ticketAdminChannelId: '1085375115233087488',
            ticketMessage: outdent`
                Please send the following to be verified.

                1. A photo of you holding your ID showing just the date of birth and the photo, everything else should be covered.
                2. A photo of you holding a piece of paper with your discord username and today's date written on it.
            `,
            transcriptionsChannelId: '1085375283886030989',
            emoji: '🔞',
            panelId: ticketPanelId,
        })
        .execute();
    console.log('done');

    // Create the main ticket panel in the "create-a-ticket" channel
    console.log('Creating a panel');
    await db
        .insertInto('panels')
        .ignore()
        .values({
            id: ticketPanelId,
            buttonMessage: 'Create a ticket',
            channelId: '1085374793416712232',
            managerRoleIds: json([]),
            categoryIds: json([
                supportCategoryId,
                verificationCategoryId,
            ]),
            guildId: guildId,
            enabled: true,
        })
        .execute();
    console.log('done');
};

void seedDatabase();