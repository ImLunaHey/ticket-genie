import { generateInputString } from '@app/common/generate-input-string';
import { Colors, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const generateAdminTicketMessage = ({
    categoryName,
    status,
    createdById,
    claimedById,
    ticketId,
    ticketNumber,
    note,
}: {
    categoryName: string;
    status: 'OPEN' | 'CLOSED' | 'PENDING';
    createdById: string;
    claimedById?: string;
    ticketId: string;
    ticketNumber: number;
    note?: string;
}) => {
    const color = {
        OPEN: Colors.Green,
        CLOSED: Colors.Grey,
        PENDING: Colors.Yellow,
    }[status];

    const embed = new EmbedBuilder({
        title: categoryName,
        color: color ?? Colors.White,
        fields: [{
            name: 'ID',
            value: ticketId,
            inline: true,
        }, {
            name: 'Created by',
            value: `<@${createdById}>`,
            inline: true,
        }, {
            name: claimedById ? 'Claimed by' : '\u200b',
            value: claimedById ? `<@${claimedById}>` : '\u200b',
            inline: true,
        }, {
            name: 'Status',
            value: `${status.toLowerCase()[0].toUpperCase()}${status.toLowerCase().substring(1, status.length)}`,
            inline: true,
        }],
        description: note,
        footer: {
            text: `Ticket #${ticketNumber}`,
        },
    });

    const components = {
        OPEN: new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(generateInputString('close-and-save-ticket', ticketId, { action: 'reply' }))
                    .setLabel('Close and save transcript')
                    .setEmoji('💾')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(generateInputString('close-ticket', ticketId))
                    .setLabel('Close ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(generateInputString('claim-ticket', ticketId))
                    .setLabel('Claim ticket')
                    .setEmoji('🙋‍♀️')
                    .setStyle(ButtonStyle.Success),
            ),
        PENDING: new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(generateInputString('close-and-save-ticket', ticketId, { action: 'reply' }))
                    .setLabel('Close and save transcript')
                    .setEmoji('💾')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(generateInputString('close-ticket', ticketId))
                    .setLabel('Close ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(generateInputString('unclaim-ticket', ticketId))
                    .setDisabled(true)
                    .setLabel('Ticket claimed')
                    .setEmoji('🙋‍♀️')
                    .setStyle(ButtonStyle.Success),
            ),
        CLOSED: new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(generateInputString('open-ticket', ticketId))
                    .setLabel('Open ticket')
                    .setEmoji('🔓')
                    .setStyle(ButtonStyle.Secondary),
            ),
    };
    return {
        embeds: [embed],
        components: [components[status]],
    };
};
